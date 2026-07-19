"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { MarketPricePoint } from "@/app/(platform)/market/market-data";
import type { PlantTelemetrySeriesPoint } from "@/lib/telemetry/energy-metrics";

type MarketPriceChartProps = {
  series: MarketPricePoint[];
  thresholdPrice: number;
  /** Short, pre-formatted current production/grid-power text shown on the NOW marker. Omitted entirely when unavailable — never a placeholder. */
  nowAnnotation?: string;
  /**
   * Real, today-so-far DeviceTelemetry (5-minute resolution). Merged with
   * `series` into one shared, timestamp-aligned dataset (see
   * `buildUnifiedData`) so every rendered series — including the tooltip —
   * refers to the exact same row/timestamp. Omitted entirely (no axis, no
   * lines, no legend entries) when empty.
   */
  telemetrySeries?: PlantTelemetrySeriesPoint[];
  /**
   * The plant's configured installed capacity (kW) — read from
   * `Plant.capacityKw`, never hardcoded, never derived from the visible
   * telemetry. The power axis is fixed at `[0, installedCapacityKw]`
   * whenever this is known; when it's `null` (not configured), the power
   * axis/telemetry lines are omitted entirely rather than guessing a
   * scale from the data.
   */
  installedCapacityKw?: number | null;
};

/** One row per distinct timestamp across BOTH price and telemetry — the single source of truth for every Line and the Tooltip, so hovering any point always reflects one real, shared timestamp. */
type UnifiedDatum = {
  time: number;
  price: number | null;
  productionKw: number | null;
  exportKw: number | null;
  importKw: number | null;
};

function formatSofiaTime(time: number): string {
  return new Date(time).toLocaleTimeString("en-GB", {
    timeZone: "Europe/Sofia",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Groups consecutive export-enabled intervals into contiguous [start, end) ranges for shading. */
function getExportBands(
  series: MarketPricePoint[],
): Array<{ start: number; end: number }> {
  const bands: Array<{ start: number; end: number }> = [];
  let bandStart: number | null = null;
  const first = series[0];
  const second = series[1];
  const intervalMs =
    first && second
      ? second.timestamp.getTime() - first.timestamp.getTime()
      : 0;

  series.forEach((point, index) => {
    const time = point.timestamp.getTime();

    if (point.exportEnabled && bandStart === null) {
      bandStart = time;
    }

    const isLast = index === series.length - 1;
    const nextDisables = !point.exportEnabled;

    if (bandStart !== null && (nextDisables || isLast)) {
      const end = isLast && point.exportEnabled ? time + intervalMs : time;
      bands.push({ start: bandStart, end });
      bandStart = null;
    }
  });

  return bands;
}

/**
 * Merges the price series (native resolution, e.g. 15 minutes) and the
 * telemetry series (5-minute resolution) into one array keyed by the union
 * of both series' real timestamps.
 *
 * - `productionKw`/`exportKw`/`importKw` use exact-timestamp matches only
 *   — a telemetry gap stays `null` (a real gap), never interpolated.
 * - `price` is forward-filled across the intervening rows within its own
 *   native interval (e.g. the 5-min sub-rows between two 15-min price
 *   points repeat that block's real value) — this is not fabrication: a
 *   day-ahead price genuinely applies to its whole interval, not just its
 *   first instant. A genuinely missing price interval stays `null` across
 *   that entire interval, so the line still breaks there
 *   (`connectNulls={false}`), it just no longer breaks at every
 *   telemetry-only sub-row the way two independent per-Line `data` arrays
 *   previously did — which was the root cause of the tooltip showing
 *   mismatched timestamps across series.
 */
function buildUnifiedData(
  priceSeries: MarketPricePoint[],
  telemetrySeries: PlantTelemetrySeriesPoint[],
): UnifiedDatum[] {
  const firstPriceTime = priceSeries[0]?.timestamp.getTime();
  const secondPriceTime = priceSeries[1]?.timestamp.getTime();
  const priceIntervalMs =
    firstPriceTime !== undefined && secondPriceTime !== undefined
      ? secondPriceTime - firstPriceTime
      : 0;

  const priceByTime = new Map(
    priceSeries.map((p) => [p.timestamp.getTime(), p.price]),
  );

  function priceAt(t: number): number | null {
    if (firstPriceTime === undefined || priceIntervalMs <= 0) {
      return priceByTime.get(t) ?? null;
    }

    const bucketStart =
      firstPriceTime +
      Math.floor((t - firstPriceTime) / priceIntervalMs) * priceIntervalMs;

    return priceByTime.get(bucketStart) ?? null;
  }

  const telemetryByTime = new Map(
    telemetrySeries.map((t) => [t.timestamp.getTime(), t]),
  );

  const allTimes = new Set<number>();
  for (const p of priceSeries) allTimes.add(p.timestamp.getTime());
  for (const t of telemetrySeries) allTimes.add(t.timestamp.getTime());

  return [...allTimes]
    .sort((a, b) => a - b)
    .map((time) => {
      const telemetry = telemetryByTime.get(time);

      return {
        time,
        price: priceAt(time),
        productionKw: telemetry?.productionKw ?? null,
        exportKw: telemetry?.exportKw ?? null,
        importKw: telemetry?.importKw ?? null,
      };
    });
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number | null; dataKey: string }>;
  label?: number;
}) {
  if (!active || !payload || payload.length === 0 || label === undefined) {
    return null;
  }

  const get = (key: string): number | null => {
    const value = payload.find((entry) => entry.dataKey === key)?.value;
    return value === undefined ? null : value;
  };

  const price = get("price");
  const production = get("productionKw");
  const exportKw = get("exportKw");
  const importKw = get("importKw");
  const hasAnything =
    price !== null || production !== null || exportKw !== null || importKw !== null;

  return (
    <div className="rounded-xl border border-white/10 bg-[#0b1020] px-3 py-2 text-xs shadow-[0_12px_28px_-16px_rgba(0,0,0,0.7)]">
      <p className="font-medium text-slate-300">{formatSofiaTime(label)}</p>

      {price !== null && (
        <p className="mt-1 flex items-center gap-1.5 text-blue-400">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
          {price} EUR/MWh
        </p>
      )}

      {production !== null && (
        <p className="mt-1 flex items-center gap-1.5 text-amber-400">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          {production} kW production
        </p>
      )}

      {exportKw !== null && exportKw > 0 && (
        <p className="mt-1 flex items-center gap-1.5 text-violet-400">
          <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
          {exportKw} kW export
        </p>
      )}

      {importKw !== null && importKw > 0 && (
        <p className="mt-1 flex items-center gap-1.5 text-rose-400">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
          {importKw} kW import
        </p>
      )}

      {!hasAnything && <p className="mt-1 text-slate-500">No data</p>}
    </div>
  );
}

/** Custom label for the threshold reference line — a two-line pill instead of plain axis text. */
function ThresholdLabel(props: {
  viewBox?: { x?: number; y?: number; width?: number };
  thresholdPrice: number;
}) {
  const { viewBox, thresholdPrice } = props;
  if (!viewBox || viewBox.x === undefined || viewBox.y === undefined) {
    return null;
  }

  const x = (viewBox.x ?? 0) + (viewBox.width ?? 0) - 4;
  const y = viewBox.y - 26;

  return (
    <g transform={`translate(${x}, ${y})`} textAnchor="end">
      <rect
        x={-118}
        y={-1}
        width={118}
        height={28}
        rx={6}
        fill="#0b1020"
        stroke="rgba(251,191,36,0.35)"
      />
      <text x={-8} y={11} fontSize={9} fontWeight={600} fill="#fbbf24" letterSpacing={0.4}>
        EXPORT THRESHOLD
      </text>
      <text x={-8} y={22} fontSize={10} fill="#fcd34d">
        {thresholdPrice} EUR/MWh
      </text>
    </g>
  );
}

/**
 * Custom label for the NOW marker — a small pill badge with a pulsing
 * dot, like a live terminal cursor. Optionally carries a short real-time
 * production/grid-power annotation (Part 4's "overlay current production
 * and current export power" — a point-in-time annotation on the current
 * moment, not a fabricated time series, since only a single current
 * reading exists, not historical production data at price-interval
 * resolution).
 */
function NowLabel(props: {
  viewBox?: { x?: number; y?: number };
  annotation?: string;
}) {
  const { viewBox, annotation } = props;
  if (!viewBox || viewBox.x === undefined || viewBox.y === undefined) {
    return null;
  }

  if (!annotation) {
    return (
      <g transform={`translate(${viewBox.x}, ${viewBox.y - 6})`}>
        <rect x={-20} y={-16} width={40} height={16} rx={8} fill="#0891b2" />
        <circle cx={-11} cy={-8} r={2.5} fill="#5eead4">
          <animate
            attributeName="opacity"
            values="1;0.35;1"
            dur="1.6s"
            repeatCount="indefinite"
          />
        </circle>
        <text x={4} y={-4} textAnchor="middle" fontSize={9} fontWeight={700} fill="#ecfeff">
          NOW
        </text>
      </g>
    );
  }

  const pillWidth = Math.max(70, annotation.length * 5.2 + 20);

  return (
    <g transform={`translate(${viewBox.x}, ${viewBox.y - 34})`}>
      <rect
        x={-pillWidth / 2}
        y={-1}
        width={pillWidth}
        height={30}
        rx={6}
        fill="#0891b2"
      />
      <circle cx={-pillWidth / 2 + 10} cy={11} r={2.5} fill="#5eead4">
        <animate
          attributeName="opacity"
          values="1;0.35;1"
          dur="1.6s"
          repeatCount="indefinite"
        />
      </circle>
      <text
        x={-pillWidth / 2 + 18}
        y={14}
        fontSize={9}
        fontWeight={700}
        fill="#ecfeff"
      >
        NOW
      </text>
      <text
        x={0}
        y={24}
        textAnchor="middle"
        fontSize={9}
        fill="#cffafe"
      >
        {annotation}
      </text>
    </g>
  );
}

/**
 * The Market page's hero chart — real ENTSO-E day-ahead price (blue, left
 * axis, EUR/MWh, auto-scaled) and, when telemetry + installed capacity are
 * both known, real production (amber), export (violet), and import (rose)
 * on a shared right axis (kW), fixed at `[0, installedCapacityKw]` —
 * never auto-scaled from the visible values, never negative.
 *
 * Everything shares ONE unified, timestamp-merged dataset (see
 * `buildUnifiedData`) instead of separate per-series arrays, so hovering
 * any point on the chart always shows every series' value at that exact
 * same real timestamp — no cross-series misalignment.
 *
 * Gaps are always genuine: `connectNulls={false}` throughout, and the
 * merge never invents a telemetry sample or extends a price value past
 * its own real interval (see `buildUnifiedData`'s doc comment for exactly
 * what forward-filling price does and does not do).
 */
export function MarketPriceChart({
  series,
  thresholdPrice,
  nowAnnotation,
  telemetrySeries,
  installedCapacityKw,
}: MarketPriceChartProps) {
  const hasTelemetry = Boolean(telemetrySeries && telemetrySeries.length > 0);
  const hasPowerAxis =
    hasTelemetry && installedCapacityKw !== null && installedCapacityKw !== undefined;

  const data: UnifiedDatum[] = hasPowerAxis
    ? buildUnifiedData(series, telemetrySeries ?? [])
    : series.map((point) => ({
        time: point.timestamp.getTime(),
        price: point.price,
        productionKw: null,
        exportKw: null,
        importKw: null,
      }));

  const bands = getExportBands(series);
  const now = Date.now();
  const domainStart = data[0]?.time;
  const domainEnd = data[data.length - 1]?.time;
  const nowInRange =
    domainStart !== undefined &&
    domainEnd !== undefined &&
    now >= domainStart &&
    now <= domainEnd;

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-1 text-xs">
        <span className="flex items-center gap-1.5 text-slate-300">
          <span className="h-0.5 w-3 rounded-full bg-blue-400" />
          Day-ahead price
        </span>

        <span className="h-3 w-px bg-white/10" />

        <span className="flex items-center gap-1.5 text-slate-500">
          <span className="h-0.5 w-3 rounded-full border-t border-dashed border-amber-400" />
          Export threshold
        </span>

        <span className="flex items-center gap-1.5 text-slate-500">
          <span className="h-2.5 w-2.5 rounded-sm bg-gradient-to-b from-emerald-400/40 to-emerald-400/0" />
          Export window
        </span>

        {hasPowerAxis && (
          <>
            <span className="h-3 w-px bg-white/10" />

            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="h-0.5 w-3 rounded-full bg-amber-400" />
              Real production
            </span>

            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="h-0.5 w-3 rounded-full bg-violet-400" />
              Real export
            </span>

            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="h-0.5 w-3 rounded-full bg-rose-400" />
              Real import
            </span>
          </>
        )}
      </div>

      <div className="mt-2 min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: nowAnnotation ? 46 : 30, right: 12, bottom: 0, left: 0 }}
          >
            <defs>
              <linearGradient id="exportBandFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#34d399" stopOpacity={0.16} />
                <stop offset="100%" stopColor="#34d399" stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />

            {bands.map((band) => (
              <ReferenceArea
                key={band.start}
                x1={band.start}
                x2={band.end}
                fill="url(#exportBandFill)"
                stroke="#34d399"
                strokeOpacity={0.25}
                strokeWidth={1}
              />
            ))}

            <XAxis
              dataKey="time"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={formatSofiaTime}
              tick={{ fill: "#64748b", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              tickMargin={10}
              minTickGap={48}
            />

            <YAxis
              yAxisId="price"
              tick={{ fill: "#64748b", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={52}
              tickMargin={8}
              label={{
                value: "EUR/MWh",
                angle: -90,
                position: "insideLeft",
                fill: "#64748b",
                fontSize: 10,
              }}
            />

            {hasPowerAxis && (
              <YAxis
                yAxisId="power"
                orientation="right"
                tick={{ fill: "#64748b", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={52}
                tickMargin={8}
                // Engineering scale, per the plant's own configured
                // installed capacity — never auto-scaled from the
                // visible telemetry, and never negative. A genuine
                // production/export/import value is always >= 0 (see
                // energy-metrics.ts's max(x, 0) clamps), so [0, capacity]
                // is the physically correct fixed range, not a cosmetic
                // choice.
                domain={[0, installedCapacityKw]}
                allowDataOverflow
                label={{
                  value: "kW",
                  angle: -90,
                  position: "insideRight",
                  fill: "#64748b",
                  fontSize: 10,
                }}
              />
            )}

            <Tooltip content={<ChartTooltip />} />

            <ReferenceLine
              yAxisId="price"
              y={thresholdPrice}
              stroke="#fbbf24"
              strokeOpacity={0.6}
              strokeWidth={1.5}
              strokeDasharray="5 4"
              label={<ThresholdLabel thresholdPrice={thresholdPrice} />}
            />

            {nowInRange && (
              <ReferenceLine
                x={now}
                stroke="#22d3ee"
                strokeOpacity={0.55}
                strokeWidth={1.5}
                label={<NowLabel annotation={nowAnnotation} />}
              />
            )}

            <Line
              yAxisId="price"
              type="monotone"
              dataKey="price"
              stroke="#60a5fa"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3.5, fill: "#93c5fd" }}
              connectNulls={false}
              isAnimationActive
              animationDuration={700}
            />

            {hasPowerAxis && (
              <Line
                yAxisId="power"
                type="monotone"
                dataKey="productionKw"
                stroke="#fbbf24"
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, fill: "#fcd34d" }}
                connectNulls={false}
                isAnimationActive
                animationDuration={700}
              />
            )}

            {hasPowerAxis && (
              <Line
                yAxisId="power"
                type="monotone"
                dataKey="exportKw"
                stroke="#a78bfa"
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, fill: "#c4b5fd" }}
                connectNulls={false}
                isAnimationActive
                animationDuration={700}
              />
            )}

            {hasPowerAxis && (
              <Line
                yAxisId="power"
                type="monotone"
                dataKey="importKw"
                stroke="#fb7185"
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, fill: "#fda4af" }}
                connectNulls={false}
                isAnimationActive
                animationDuration={700}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
