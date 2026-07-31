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
   * axis's per-point capacity scale — never the data itself.
   */
  xAxisUnit?: "time" | "day" | "month";
};

const X_AXIS_TICK_FORMATTERS: Record<"time" | "day" | "month", (time: number) => string> = {
  time: formatSofiaTime,
  day: formatSofiaDate,
  month: formatSofiaMonth,
};

/** Hours represented by one data point, per `xAxisUnit` — the export-energy axis scale is "installed capacity x this many hours", so a Week/Month/Year chart's bars stay physically meaningful instead of using Today's fixed 15-minute scale. Average month length for "year", since points don't fall on the same day count. */
const HOURS_PER_POINT: Record<"time" | "day" | "month", number> = {
  time: 15 / 60,
  day: 24,
  month: (365 / 12) * 24,
};

/** One row per real price timestamp, carrying that same interval's exported energy (if any) — see `settlementEnergySeries`'s prop doc comment for why no resampling is needed. */
type UnifiedDatum = {
  time: number;
  price: number | null;
  exportedKwh: number | null;
};

/**
 * Left price axis tick labels - only round multiples of 50 EUR/MWh that
 * actually lie within `[min, max]`, never the domain's own (often
 * fractional) endpoints. The domain itself is untouched by this - only
 * which values get a visible label changes.
 */
function computeMultipleOf50Ticks(min: number, max: number): number[] {
  const ticks: number[] = [];

  for (let tick = Math.ceil(min / 50) * 50; tick <= max; tick += 50) {
    ticks.push(tick);
  }

  return ticks;
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
  const hasAnything = price !== null || exportedKwh !== null;

  return (
    <div className={CHART_TOOLTIP_CLASSNAME}>
      <p className="font-medium text-slate-300">{labelFormatter(label)}</p>

      {price !== null && (
        <p className="mt-1 flex items-center gap-1.5 text-blue-400">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
          {price} EUR/MWh
        </p>
      )}

      {exportedKwh !== null && (
        <p className="mt-1 flex items-center gap-1.5 text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {exportedKwh} {t("exportedKwhSuffix")}
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
  installedCapacityKw,
  xAxisUnit = "time",
}: MarketPriceChartProps) {
  const t = useTranslations("market.priceChart");
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
  // capacity applied for one whole bucket's duration (a 15-minute
  // settlement interval for "time"/Today, a full day for Week/Month, an
  // average month for Year — see `HOURS_PER_POINT`) — the physical maximum
  // a plant this size could export in that span. Never auto-scaled from
  // the visible bars, never negative (a genuine exported-energy value is
  // always >= 0, since it's a counter difference — see energy-metrics.ts).
  const maxExportedKwhPerInterval = hasEnergyAxis
    ? Math.round((installedCapacityKw as number) * HOURS_PER_POINT[xAxisUnit] * 100) / 100
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
  const minKnownPrice = knownPrices.length > 0 ? Math.min(...knownPrices) : undefined;
  const maxKnownPrice = knownPrices.length > 0 ? Math.max(...knownPrices) : undefined;
  const priceAxisDomain: [number, number] =
    minKnownPrice !== undefined && maxKnownPrice !== undefined
      ? [minKnownPrice < 0 ? minKnownPrice - 10 : -10, maxKnownPrice + 20]
      : [-10, 20];
  const priceAxisTicks = computeMultipleOf50Ticks(priceAxisDomain[0], priceAxisDomain[1]);

  // Right export-energy axis ticks: four round steps derived from the
  // plant's own AC capacity, not the fixed decimal values recharts would
  // otherwise pick from maxExportedKwhPerInterval. The domain itself
  // (0..maxExportedKwhPerInterval) is unchanged - only which values get a
  // visible label changes.
  const energyAxisStep = hasEnergyAxis
    ? Math.floor((installedCapacityKw as number) / 12 / 5) * 5
    : 0;
  const energyAxisTicks = hasEnergyAxis
    ? [0, energyAxisStep, energyAxisStep * 2, energyAxisStep * 3]
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
          {t("electricityPrice")}
        </span>

        <span className="h-3 w-px bg-white/10" />

        <span className="flex items-center gap-1.5 text-slate-500">
          <span className="h-0.5 w-3 rounded-full border-t border-dashed border-amber-400" />
          {t("exportThreshold")}
        </span>

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

          {hasEnergyAxis && (
            <Bar
              yAxisId="energy"
              dataKey="exportedKwh"
              fill="#34d399"
              fillOpacity={0.65}
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
