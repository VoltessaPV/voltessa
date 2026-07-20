"use client";

import { Bar, Line, ReferenceArea, ReferenceLine } from "recharts";

import type { MarketPricePoint } from "@/app/(platform)/market/market-data";
import { ChartFrame, type ChartFrameYAxis } from "@/components/charts/ChartFrame";
import { CHART_TOOLTIP_CLASSNAME, computeFixedChartTicks, formatSofiaTime } from "@/components/charts/chart-style";
import { NowLabel } from "@/components/charts/NowMarker";
import type { SettlementEnergyPoint } from "@/lib/telemetry/energy-metrics";

/**
 * Market vs. Dashboard architecture split (Mathematical Correctness
 * milestone): Dashboard shows instantaneous power (kW) — production,
 * export, import. Market shows what actually determines money: the price,
 * and exported ENERGY (kWh) per real 15-minute settlement interval — never
 * export *power*. This chart therefore only ever renders price + exported
 * energy, not the production/export/import power lines earlier milestones
 * added here.
 */
type MarketPriceChartProps = {
  series: MarketPricePoint[];
  thresholdPrice: number;
  /** Short, pre-formatted current production/grid-power text shown on the NOW marker. Omitted entirely when unavailable — never a placeholder. */
  nowAnnotation?: string;
  /**
   * Real exported energy per 15-minute settlement interval — derived from
   * the meter's cumulative energy counter (see energy-metrics.ts's doc
   * comment for the empirical proof), never from power integration. Always
   * on the exact same Europe/Sofia 15-minute grid as `series`'s price
   * points (both come from `[dayStart, dayEnd)` in `production-data.ts` /
   * `market-data.ts`), so merging by timestamp needs no resampling or
   * forward-filling — unlike the previous power-based overlay, this can
   * never distort the price line's shape. Omitted entirely (no axis, no
   * bars, no legend entry) when empty.
   */
  settlementEnergySeries?: SettlementEnergyPoint[];
  /**
   * The plant's configured installed capacity (kW) — read from
   * `Plant.capacityKw`, never hardcoded, never derived from telemetry. The
   * energy axis's fixed maximum (one interval's worth of energy at full
   * capacity) is derived from this, never auto-scaled from the visible
   * data. `null` (not configured) omits the energy axis/bars entirely
   * rather than guessing a scale.
   */
  installedCapacityKw?: number | null;
};

/**
 * Matches `energy-metrics.ts`'s `SETTLEMENT_INTERVAL_MINUTES` — duplicated
 * as a literal (not imported) because that module pulls in server-only
 * Prisma code; this file only ever imports its *types*. Both this file and
 * `production-data.ts` inherit the same "15 minutes = this bidding zone's
 * real resolution" fact already established since the original ENTSO-E
 * integration milestone, so the two are extremely unlikely to drift.
 */
const SETTLEMENT_INTERVAL_MINUTES = 15;

/** One row per real price timestamp, carrying that same interval's exported energy (if any) — see `settlementEnergySeries`'s prop doc comment for why no resampling is needed. */
type UnifiedDatum = {
  time: number;
  price: number | null;
  exportedKwh: number | null;
};

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
 * Zips the price series with the settlement-energy series by exact
 * timestamp match — both are already on the identical Europe/Sofia
 * 15-minute grid for the selected day (see `settlementEnergySeries`'s prop
 * doc comment), so there is nothing to resample or forward-fill. This is
 * the direct fix for the earlier milestone's price-curve distortion: that
 * version forward-filled price across a denser 5-minute telemetry grid,
 * which visually turned a smooth line into a stair-step. With both series
 * sharing one grid, `price` here is always exactly the same value/
 * timestamp pair as the original, un-merged price series.
 */
function buildUnifiedData(
  priceSeries: MarketPricePoint[],
  energySeries: SettlementEnergyPoint[],
): UnifiedDatum[] {
  const energyByTime = new Map(
    energySeries.map((e) => [e.intervalStart.getTime(), e.exportedKwh]),
  );

  return priceSeries.map((point) => ({
    time: point.timestamp.getTime(),
    price: point.price,
    exportedKwh: energyByTime.get(point.timestamp.getTime()) ?? null,
  }));
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
  const exportedKwh = get("exportedKwh");
  const hasAnything = price !== null || exportedKwh !== null;

  return (
    <div className={CHART_TOOLTIP_CLASSNAME}>
      <p className="font-medium text-slate-300">{formatSofiaTime(label)}</p>

      {price !== null && (
        <p className="mt-1 flex items-center gap-1.5 text-blue-400">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
          {price} EUR/MWh
        </p>
      )}

      {exportedKwh !== null && (
        <p className="mt-1 flex items-center gap-1.5 text-violet-400">
          <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
          {exportedKwh} kWh exported
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
 * The Market page's hero chart — real ENTSO-E day-ahead price (blue line,
 * left axis, EUR/MWh) and, when settlement energy + installed capacity are
 * both known, real exported energy (violet bars, right axis, kWh per
 * 15-minute interval) — never export *power*, per this file's top doc
 * comment.
 *
 * Both series share ONE unified, timestamp-merged dataset
 * (`buildUnifiedData`) built from two arrays that are already on the same
 * grid, so hovering any point shows both values at that exact same real
 * timestamp with no cross-series misalignment, and the price line's shape
 * is pixel-for-pixel what it would be if rendered alone.
 */
export function MarketPriceChart({
  series,
  thresholdPrice,
  nowAnnotation,
  settlementEnergySeries,
  installedCapacityKw,
}: MarketPriceChartProps) {
  const hasEnergyData = Boolean(
    settlementEnergySeries && settlementEnergySeries.length > 0,
  );
  const hasEnergyAxis =
    hasEnergyData && installedCapacityKw !== null && installedCapacityKw !== undefined;

  const data: UnifiedDatum[] = hasEnergyData
    ? buildUnifiedData(series, settlementEnergySeries ?? [])
    : series.map((point) => ({
        time: point.timestamp.getTime(),
        price: point.price,
        exportedKwh: null,
      }));

  // Engineering scale for exported energy: the plant's real installed
  // capacity applied for one whole settlement interval — the physical
  // maximum a plant this size could export in 15 minutes. Never
  // auto-scaled from the visible bars, never negative (a genuine exported-
  // energy value is always >= 0, since it's a counter difference — see
  // energy-metrics.ts).
  const maxExportedKwhPerInterval = hasEnergyAxis
    ? Math.round(
        (installedCapacityKw as number) * (SETTLEMENT_INTERVAL_MINUTES / 60) * 100,
      ) / 100
    : 0;

  const bands = getExportBands(series);
  const now = Date.now();
  const domainStart = data[0]?.time;
  const domainEnd = data[data.length - 1]?.time;
  const nowInRange =
    domainStart !== undefined &&
    domainEnd !== undefined &&
    now >= domainStart &&
    now <= domainEnd;
  // Fixed 90-minute ticks (01:30, 03:00, ...) — `data[0].time` is always
  // the selected day's local midnight (`market-data.ts`'s `buildSeries`).
  const xTicks = domainStart !== undefined ? computeFixedChartTicks(domainStart) : undefined;

  const yAxes: ChartFrameYAxis[] = [
    { yAxisId: "price", unitLabel: "EUR/MWh" },
    ...(hasEnergyAxis
      ? [
          {
            yAxisId: "energy",
            orientation: "right" as const,
            domain: [0, maxExportedKwhPerInterval] as [number, number],
            allowDataOverflow: true,
            unitLabel: "kWh",
          },
        ]
      : []),
  ];

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-1 text-xs">
        <span className="flex items-center gap-1.5 text-slate-300">
          <span className="h-0.5 w-3 rounded-full bg-blue-400" />
          Electricity price
        </span>

        <span className="h-3 w-px bg-white/10" />

        <span className="flex items-center gap-1.5 text-slate-500">
          <span className="h-0.5 w-3 rounded-full border-t border-dashed border-amber-400" />
          Export threshold
        </span>

        <span className="flex items-center gap-1.5 text-slate-500">
          <span className="h-2.5 w-2.5 rounded-sm bg-gradient-to-b from-emerald-400/40 to-emerald-400/0" />
          Recommended export
        </span>

        {hasEnergyAxis && (
          <>
            <span className="h-3 w-px bg-white/10" />

            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="h-2.5 w-2.5 rounded-sm bg-violet-400" />
              Exported energy
            </span>
          </>
        )}
      </div>

      <div className="mt-2 min-h-0 flex-1">
        <ChartFrame
          data={data}
          yAxes={yAxes}
          tooltipContent={<ChartTooltip />}
          hasAnnotationMargin={Boolean(nowAnnotation)}
          xTicks={xTicks}
        >
          {bands.map((band) => (
            <ReferenceArea
              key={band.start}
              x1={band.start}
              x2={band.end}
              fill="rgba(52,211,153,0.12)"
              stroke="#34d399"
              strokeOpacity={0.25}
              strokeWidth={1}
            />
          ))}

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

          {hasEnergyAxis && (
            <Bar
              yAxisId="energy"
              dataKey="exportedKwh"
              fill="#a78bfa"
              fillOpacity={0.65}
              radius={[2, 2, 0, 0]}
              isAnimationActive
              animationDuration={700}
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
        </ChartFrame>
      </div>
    </div>
  );
}
