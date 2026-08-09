"use client";

import { useTranslations } from "next-intl";
import { Bar, Line, ReferenceLine } from "recharts";

import type { MarketPricePoint } from "@/app/[locale]/(platform)/market/market-data";
import { ChartFrame, type ChartFrameYAxis } from "@/components/charts/ChartFrame";
import {
  CHART_TOOLTIP_CLASSNAME,
  computeFixedChartTicks,
  formatSofiaDate,
  formatSofiaMonth,
  formatSofiaTime,
} from "@/components/charts/chart-style";
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
   *
   * Only `intervalStart`/`exportedKwh` — this chart never renders imported
   * energy, so `production-data.ts`'s full `SettlementEnergyPoint` (which
   * also carries `importedKwh`, used elsewhere for the Dashboard/Market
   * KPI totals) is narrowed to these two fields at the prop boundary
   * (`market/page.tsx`) so `importedKwh` never crosses into this RSC
   * payload for a field nothing here reads.
   */
  settlementEnergySeries?: Pick<SettlementEnergyPoint, "intervalStart" | "exportedKwh">[];
  /**
   * Available-PV visualization fix (Digital Twin's "Current (historical)"
   * panel only - every other caller of this shared component omits this
   * prop and is completely unaffected). NOT total reconstructed PV
   * production - the caller (`app/admin/digital-twin/actions.ts`'s
   * `computeAdditionalAvailablePvKwh`) has already computed exactly the
   * additional energy that physically existed but was suppressed by
   * historical Zero Export, above whatever was actually exported - zero for
   * every interval Zero Export wasn't active, by construction. This
   * component renders that value as-is, as a grey segment stacked ON TOP of
   * the existing green `exportedKwh` segment (never re-subtracted here -
   * the incoming value already IS the "additional" amount), so the total
   * stacked bar height is `exportedKwh + additionalAvailablePvKwh` -
   * historical export plus the reconstructed Zero-Export opportunity above
   * it. Omitted entirely (no grey segment, no legend entry, no axis change)
   * when not supplied.
   */
  availablePvEnergySeries?: { intervalStart: Date; availablePvKwh: number | null }[];
  /**
   * The plant's configured installed capacity (kW) — read from
   * `Plant.capacityKw`, never hardcoded, never derived from telemetry. The
   * energy axis's fixed maximum (one interval's worth of energy at full
   * capacity) is derived from this, never auto-scaled from the visible
   * data. `null` (not configured) omits the energy axis/bars entirely
   * rather than guessing a scale.
   */
  installedCapacityKw?: number | null;
  /**
   * Dashboard & Market Analytics milestone (Weekly/Monthly/Yearly). What
   * each `series`/`settlementEnergySeries` point represents — a real
   * 15-minute interval ("time", the default, unchanged Today behavior), a
   * whole calendar day ("day", Week/Month), or a whole calendar month
   * ("year"). Only changes X-axis tick labels/spacing and the export-energy
   * axis's scale (Historical Analytics Refinement milestone — see
   * `computeNiceEnergyAxis`) — never the data itself.
   */
  xAxisUnit?: "time" | "day" | "month";
  /**
   * Historical Analytics Refinement milestone. Export Threshold (the line,
   * its legend entry, and the pill label) is an operational, today-only
   * concept — a historical Average Selling Price has no "threshold" to
   * compare against. Defaults to `true` (unchanged Today behavior);
   * `market/page.tsx` passes `false` for Week/Month/Year.
   */
  showThreshold?: boolean;
  /**
   * Historical Analytics Refinement milestone. Which real metric `series`'s
   * blue line actually carries — `"electricity"` (the default, unchanged
   * Today behavior) is the raw real-time ENTSO-E price; `"averageSelling"`
   * is the plant's real Average Selling Price for Week/Month/Year
   * (`market/page.tsx`'s `buildAspChartSeries`) — a genuinely different
   * business metric, not the same values under a new label, so the legend
   * text must say which one is actually being plotted.
   */
  priceMetric?: "electricity" | "averageSelling";
  /**
   * Digital Twin Final UI Polish milestone. When two `MarketPriceChart`s
   * must be visually comparable (Current vs. Simulated), each chart's own
   * auto-computed energy-axis max/ticks would normally differ because
   * their underlying data (and, for `xAxisUnit="time"`, their
   * `installedCapacityKw`) differ. Passing the SAME `sharedEnergyAxis` -
   * computed once by the caller from both charts' combined data via
   * `computeNiceEnergyAxis`/`computeCapacityDerivedEnergyAxis` below -
   * overrides this chart's own computation entirely, regardless of
   * `xAxisUnit`. Omitted (the default), this chart behaves exactly as
   * before: every existing caller (Market, the marketing preview) is
   * unaffected.
   */
  sharedEnergyAxis?: { max: number; ticks: number[] };
  /** Same idea as `sharedEnergyAxis`, for the left price axis. */
  sharedPriceAxis?: { domain: [number, number]; ticks: number[] };
};

const X_AXIS_TICK_FORMATTERS: Record<"time" | "day" | "month", (time: number) => string> = {
  time: formatSofiaTime,
  day: formatSofiaDate,
  month: formatSofiaMonth,
};

/** Hours in one Today settlement interval (15 minutes) — the export-energy axis's Today scale is "installed capacity x this many hours", unchanged from before the Historical Analytics Refinement milestone. Week/Month/Year no longer use a capacity-derived scale at all; see `computeNiceEnergyAxis`. */
const TODAY_SETTLEMENT_INTERVAL_HOURS = 15 / 60;

/**
 * Historical Analytics Refinement milestone. A "nice" (1/2/5 x 10^n) axis
 * maximum and evenly-spaced tick set, computed from the actual visible
 * exported-energy data instead of the plant's theoretical physical
 * capacity — the previous capacity-derived domain was almost always far
 * larger than any real bucket ever reaches (a whole day/month of exports
 * vs. one settlement interval's worth of capacity), making the bars look
 * compressed against mostly-empty axis space. Never produces awkward tick
 * values like 173/347/521. Only used for Week/Month/Year — Today's scale
 * is untouched (see `TODAY_SETTLEMENT_INTERVAL_HOURS`).
 */
export function computeNiceEnergyAxis(maxDataValue: number): { max: number; ticks: number[] } {
  if (maxDataValue <= 0) {
    return { max: 0, ticks: [0] };
  }

  const roughStep = maxDataValue / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const normalized = roughStep / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step = niceNormalized * magnitude;
  const max = Math.ceil(maxDataValue / step) * step;

  const ticks: number[] = [];
  for (let tick = 0; tick <= max + step / 2; tick += step) {
    ticks.push(Math.round(tick));
  }

  return { max, ticks };
}

/**
 * Digital Twin Final UI Polish milestone. Extracted, unchanged, from this
 * component's own `xAxisUnit === "time"` energy-axis calculation - the
 * exact same "installed capacity x one settlement interval's worth of
 * hours" scale, exported so a caller needing a SHARED axis across two
 * charts with different `installedCapacityKw` (Current vs. Simulated) can
 * compute it once, e.g. from `Math.max(currentCapacityKw, newCapacityKw)`.
 */
export function computeCapacityDerivedEnergyAxis(installedCapacityKw: number): { max: number; ticks: number[] } {
  const max = Math.round(installedCapacityKw * TODAY_SETTLEMENT_INTERVAL_HOURS * 100) / 100;
  const step = Math.floor(installedCapacityKw / 12 / 5) * 5;
  return { max, ticks: [0, step, step * 2, step * 3] };
}

/** One row per real price timestamp, carrying that same interval's exported energy (if any) — see `settlementEnergySeries`'s prop doc comment for why no resampling is needed. */
type UnifiedDatum = {
  time: number;
  price: number | null;
  exportedKwh: number | null;
  /**
   * Additional energy suppressed by historical Zero Export, ABOVE
   * `exportedKwh` - see `availablePvEnergySeries`'s prop doc comment. Already
   * exactly zero outside Zero Export (computed by the caller), so this is
   * rendered as-is, never re-derived here. `null` when that prop is omitted
   * or has no value for this timestamp - the grey segment simply doesn't
   * render for that point.
   */
  availablePvKwh: number | null;
};

/**
 * Left price axis tick labels - only round multiples of 50 EUR/MWh that
 * actually lie within `[min, max]`, never the domain's own (often
 * fractional) endpoints. The domain itself is untouched by this - only
 * which values get a visible label changes.
 */
export function computeMultipleOf50Ticks(min: number, max: number): number[] {
  const ticks: number[] = [];

  for (let tick = Math.ceil(min / 50) * 50; tick <= max; tick += 50) {
    ticks.push(tick);
  }

  return ticks;
}

/**
 * Digital Twin Final UI Polish milestone. Extracted, unchanged, from this
 * component's own price-axis domain calculation, so a caller can compute
 * ONE shared domain from the union of two charts' known prices (Current +
 * Simulated) and pass it to both via `sharedPriceAxis`.
 */
export function computePriceAxisDomain(knownPrices: number[]): { domain: [number, number]; ticks: number[] } {
  const minKnownPrice = knownPrices.length > 0 ? Math.min(...knownPrices) : undefined;
  const maxKnownPrice = knownPrices.length > 0 ? Math.max(...knownPrices) : undefined;
  const domain: [number, number] =
    minKnownPrice !== undefined && maxKnownPrice !== undefined
      ? [minKnownPrice < 0 ? minKnownPrice - 10 : -10, maxKnownPrice + 20]
      : [-10, 20];

  return { domain, ticks: computeMultipleOf50Ticks(domain[0], domain[1]) };
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
  energySeries: Pick<SettlementEnergyPoint, "intervalStart" | "exportedKwh">[],
  availablePvSeries: { intervalStart: Date; availablePvKwh: number | null }[],
): UnifiedDatum[] {
  const energyByTime = new Map(
    energySeries.map((e) => [e.intervalStart.getTime(), e.exportedKwh]),
  );
  const availablePvByTime = new Map(availablePvSeries.map((p) => [p.intervalStart.getTime(), p.availablePvKwh]));

  return priceSeries.map((point) => {
    const exportedKwh = energyByTime.get(point.timestamp.getTime()) ?? null;
    const availablePvKwh = availablePvByTime.get(point.timestamp.getTime()) ?? null;
    return {
      time: point.timestamp.getTime(),
      price: point.price,
      exportedKwh,
      availablePvKwh,
    };
  });
}

function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter = formatSofiaTime,
}: {
  active?: boolean;
  payload?: Array<{ value: number | null; dataKey: string }>;
  label?: number;
  labelFormatter?: (time: number) => string;
}) {
  const t = useTranslations("market.priceChart");

  if (!active || !payload || payload.length === 0 || label === undefined) {
    return null;
  }

  const get = (key: string): number | null => {
    const value = payload.find((entry) => entry.dataKey === key)?.value;
    return value === undefined ? null : value;
  };

  const price = get("price");
  const exportedKwh = get("exportedKwh");
  const availablePvKwh = get("availablePvKwh");
  const hasAnything = price !== null || exportedKwh !== null || availablePvKwh !== null;

  return (
    <div className={CHART_TOOLTIP_CLASSNAME}>
      <p className="font-medium text-slate-300">{labelFormatter(label)}</p>

      {price !== null && (
        <p className="mt-1 flex items-center gap-1.5 text-blue-400">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
          {price} EUR/MWh
        </p>
      )}

      {availablePvKwh !== null && (
        <p className="mt-1 flex items-center gap-1.5 text-slate-400">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
          Available PV {availablePvKwh.toFixed(2)} kWh
        </p>
      )}

      {exportedKwh !== null && (
        <p className="mt-1 flex items-center gap-1.5 text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {exportedKwh.toFixed(2)} {t("exportedKwhSuffix")}
        </p>
      )}

      {!hasAnything && <p className="mt-1 text-slate-500">{t("noData")}</p>}
    </div>
  );
}

/** Custom label for the threshold reference line — a two-line pill instead of plain axis text. */
function ThresholdLabel(props: {
  viewBox?: { x?: number; y?: number; width?: number };
  thresholdPrice: number;
}) {
  const t = useTranslations("market.priceChart");
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
        {t("exportThresholdLabel")}
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
 * both known, real exported energy (green bars, right axis, kWh per
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
  availablePvEnergySeries,
  installedCapacityKw,
  xAxisUnit = "time",
  showThreshold = true,
  priceMetric = "electricity",
  sharedEnergyAxis,
  sharedPriceAxis,
}: MarketPriceChartProps) {
  const t = useTranslations("market.priceChart");
  const hasEnergyData = Boolean(
    settlementEnergySeries && settlementEnergySeries.length > 0,
  );
  const hasEnergyAxis =
    hasEnergyData && installedCapacityKw !== null && installedCapacityKw !== undefined;
  const hasAvailablePv = Boolean(availablePvEnergySeries && availablePvEnergySeries.length > 0);

  const data: UnifiedDatum[] = hasEnergyData
    ? buildUnifiedData(series, settlementEnergySeries ?? [], availablePvEnergySeries ?? [])
    : series.map((point) => ({
        time: point.timestamp.getTime(),
        price: point.price,
        exportedKwh: null,
        availablePvKwh: null,
      }));

  // Historical Analytics Refinement milestone: Today keeps its exact
  // original engineering scale (installed capacity x one settlement
  // interval's worth of hours) unchanged; Week/Month/Year now auto-scale
  // to the real visible data via `computeNiceEnergyAxis` instead, since a
  // capacity-derived domain for a whole day/month of exports made every
  // bar look tiny against mostly-empty axis space. `availablePvKwh` (when
  // present) stacks ON TOP of `exportedKwh` - the axis must fit their SUM,
  // not their max, or a Zero-Export bucket's grey segment would overflow.
  const niceEnergyAxis = hasEnergyAxis
    ? computeNiceEnergyAxis(Math.max(0, ...data.map((point) => (point.exportedKwh ?? 0) + (point.availablePvKwh ?? 0))))
    : { max: 0, ticks: [0] };
  const maxExportedKwhPerInterval = sharedEnergyAxis
    ? sharedEnergyAxis.max
    : hasEnergyAxis
      ? xAxisUnit === "time"
        ? computeCapacityDerivedEnergyAxis(installedCapacityKw as number).max
        : niceEnergyAxis.max
      : 0;

  // Left price axis: adapts to the selected day's own real ENTSO-E prices.
  // Maximum is always highest known price plus 20, unchanged. Minimum: on a
  // day that actually goes negative, lowest known price minus 10 (so an
  // unusually cheap day is never clipped); on a day that never goes
  // negative, a fixed -10 instead of e.g. "lowest known price minus 10"
  // (which produced a poor scale like 40/50 as the axis start on all-
  // positive days) - -10 keeps the zero line visible and produces the
  // familiar 0/50/100/150... scale. Falls back to a plain [-10, 20] only
  // when the day has no known price at all (nothing to derive a range
  // from).
  const knownPrices = series
    .map((point) => point.price)
    .filter((price): price is number => price !== null);
  const ownPriceAxis = computePriceAxisDomain(knownPrices);
  const priceAxisDomain: [number, number] = sharedPriceAxis ? sharedPriceAxis.domain : ownPriceAxis.domain;
  const priceAxisTicks = sharedPriceAxis ? sharedPriceAxis.ticks : ownPriceAxis.ticks;

  // Right export-energy axis ticks: for Today, four round steps derived
  // from the plant's own AC capacity, unchanged from before this
  // milestone. For Week/Month/Year, `computeNiceEnergyAxis` already
  // computed a tick set consistent with its own nice domain max above.
  const energyAxisTicks = sharedEnergyAxis
    ? sharedEnergyAxis.ticks
    : hasEnergyAxis
      ? xAxisUnit === "time"
        ? computeCapacityDerivedEnergyAxis(installedCapacityKw as number).ticks
        : niceEnergyAxis.ticks
      : undefined;

  const now = Date.now();
  const domainStart = data[0]?.time;
  const domainEnd = data[data.length - 1]?.time;
  const nowInRange =
    domainStart !== undefined &&
    domainEnd !== undefined &&
    now >= domainStart &&
    now <= domainEnd;
  // Fixed 90-minute ticks (01:30, 03:00, ...) only apply to a single
  // calendar day ("time" - Today), where `data[0].time` is always that
  // day's local midnight (`market-data.ts`'s `buildSeries`). Week/Month/
  // Year charts span many days/months, so their ticks fall back to
  // recharts' own automatic placement instead.
  const xTicks =
    xAxisUnit === "time" && domainStart !== undefined
      ? computeFixedChartTicks(domainStart)
      : undefined;
  const xAxisTickFormatter = X_AXIS_TICK_FORMATTERS[xAxisUnit];

  const yAxes: ChartFrameYAxis[] = [
    {
      yAxisId: "price",
      unitLabel: "EUR/MWh",
      domain: priceAxisDomain,
      allowDataOverflow: true,
      ticks: priceAxisTicks,
    },
    ...(hasEnergyAxis
      ? [
          {
            yAxisId: "energy",
            orientation: "right" as const,
            domain: [0, maxExportedKwhPerInterval] as [number, number],
            allowDataOverflow: true,
            ticks: energyAxisTicks,
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
          {priceMetric === "averageSelling" ? t("averageSellingPrice") : t("electricityPrice")}
        </span>

        {showThreshold && (
          <>
            <span className="h-3 w-px bg-white/10" />

            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="h-0.5 w-3 rounded-full border-t border-dashed border-amber-400" />
              {t("exportThreshold")}
            </span>
          </>
        )}

        {hasAvailablePv && (
          <>
            <span className="h-3 w-px bg-white/10" />

            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="h-2.5 w-2.5 rounded-sm bg-slate-400" />
              Available PV
            </span>
          </>
        )}

        {hasEnergyAxis && (
          <>
            <span className="h-3 w-px bg-white/10" />

            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" />
              {t("exportedEnergy")}
            </span>
          </>
        )}
      </div>

      <div className="mt-2 min-h-0 flex-1">
        <ChartFrame
          data={data}
          yAxes={yAxes}
          tooltipContent={<ChartTooltip labelFormatter={xAxisTickFormatter} />}
          hasAnnotationMargin={Boolean(nowAnnotation)}
          xTicks={xTicks}
          tickFormatter={xAxisTickFormatter}
        >
          <ReferenceLine
            yAxisId="price"
            y={0}
            stroke="#64748b"
            strokeWidth={1}
          />

          {showThreshold && (
            <ReferenceLine
              yAxisId="price"
              y={thresholdPrice}
              stroke="#fbbf24"
              strokeOpacity={0.6}
              strokeWidth={1.5}
              strokeDasharray="5 4"
              label={<ThresholdLabel thresholdPrice={thresholdPrice} />}
            />
          )}

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

          {hasEnergyAxis && (
            <Bar
              yAxisId="energy"
              dataKey="exportedKwh"
              stackId="energy"
              fill="#34d399"
              fillOpacity={0.65}
              radius={hasAvailablePv ? undefined : [2, 2, 0, 0]}
              isAnimationActive
              animationDuration={700}
            />
          )}

          {hasAvailablePv && (
            <Bar
              yAxisId="energy"
              dataKey="availablePvKwh"
              stackId="energy"
              fill="#9ca3af"
              fillOpacity={0.5}
              radius={[2, 2, 0, 0]}
              isAnimationActive
              animationDuration={700}
            />
          )}
        </ChartFrame>
      </div>
    </div>
  );
}
