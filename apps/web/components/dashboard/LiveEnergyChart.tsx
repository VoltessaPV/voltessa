"use client";

import { useTranslations } from "next-intl";
import { Line, ReferenceLine } from "recharts";

import type { EnergyFlowPoint } from "@/app/[locale]/(platform)/dashboard/dashboard-data";
import { ChartFrame, type ChartFrameYAxis } from "@/components/charts/ChartFrame";
import {
  CHART_TOOLTIP_CLASSNAME,
  computeFixedChartTicks,
  formatSofiaDate,
  formatSofiaMonth,
  formatSofiaTime,
} from "@/components/charts/chart-style";
import { NowLabel } from "@/components/charts/NowMarker";

type LiveEnergyChartProps = {
  data: EnergyFlowPoint[];
  /** Same live reading `energyFlow` uses — never a second real-time read, see `dashboard-data.ts`. */
  nowAnnotation?: string;
  /**
   * Dashboard & Market Analytics milestone (Weekly/Monthly/Yearly).
   * `"kW"` (the default, unchanged Today behavior) for instantaneous power
   * readings; `"kWh"` for Week/Month/Year, where each point is a per-day or
   * per-month ENERGY total instead (`dashboard-data.ts`'s
   * `buildPeriodChartSeries`) — same field names, same `Line`s, only the
   * unit label/tooltip text changes.
   */
  unit?: "kW" | "kWh";
  /** Same meaning as `MarketPriceChart`'s own `xAxisUnit` — see that component's doc comment. */
  xAxisUnit?: "time" | "day" | "month";
};

const X_AXIS_TICK_FORMATTERS: Record<"time" | "day" | "month", (time: number) => string> = {
  time: formatSofiaTime,
  day: formatSofiaDate,
  month: formatSofiaMonth,
};

/**
 * Today's PV production / consumption / grid import / grid export power
 * (kW) — literally the same chart component as Market's `MarketPriceChart`
 * (Design-System Consistency milestone): both render through
 * `components/charts/ChartFrame`, so the `ComposedChart`/grid/axis/
 * tooltip/margin wiring is one shared implementation, not two. Only the
 * plotted marks differ (four `Line`s here vs. `MarketPriceChart`'s
 * price `Line` + exported-energy `Bar`), exactly as this milestone
 * requires. Full 00:00-24:00 timeline, exactly like Market's price chart -
 * `data` already covers the whole calendar day with `null` for anything
 * not yet happened (see `dashboard-data.ts`'s `buildFullDayChartSeries`).
 * Import and export are mutually exclusive at every timestamp and satisfy
 * exact energy conservation (`dashboard-data.ts`'s `conserveEnergyFlow`) -
 * there is only one grid connection, rendered as two lines because a
 * single signed line would need a zero-crossing legend of its own to read
 * at a glance.
 *
 * ## Dashboard UI Refinement (Final Design Pass) milestone
 *
 * Terminology and colors now match the milestone's global naming pass:
 * PV Output (green), Total Consumption (amber — `#fbbf24`, the same
 * energy-highlight token already used for Market's Export threshold
 * line/Zero Export badges; consumption is informational, not an error
 * state, so it no longer reads as an alarm color), Import from Grid
 * (orange — `#fb923c`, the same color System Overview's
 * `EnergyFlowDiagram` already uses for its Grid node/import flow, not a
 * new one), Fed to Grid (blue). `data` itself is untouched — `gridImportKw`
 * is negated only for the rendered `Line`'s `dataKey`, in this
 * presentation-only component, so it plots below the X axis (reads
 * instantly as "leaving the site" vs. "coming from the site") without
 * changing the real, positive-magnitude value `dashboard-data.ts`
 * computes and returns.
 *
 * ## UI refinement (draw-order pass)
 *
 * `consumptionKw`'s `Line` is now written before `pvKw`'s - colors/scales/
 * layout unchanged, only which line paints on top when the two values are
 * close. Recharts (SVG) draws children in document order, so a later
 * sibling always sits above an earlier one; no z-index prop exists on
 * `Line` itself.
 */
function ChartTooltip({
  active,
  payload,
  label,
  unit = "kW",
  labelFormatter = formatSofiaTime,
}: {
  active?: boolean;
  payload?: Array<{ value: number | null; dataKey: string; color: string }>;
  label?: number;
  unit?: "kW" | "kWh";
  labelFormatter?: (time: number) => string;
}) {
  const t = useTranslations("dashboard.liveEnergy");

  if (!active || !payload || payload.length === 0 || label === undefined) {
    return null;
  }

  const rows: Array<{ key: string; textKey: string }> = [
    { key: "pvKw", textKey: "pvOutput" },
    { key: "consumptionKw", textKey: "totalConsumption" },
    { key: "gridImportNegKw", textKey: "importFromGrid" },
    { key: "gridExportKw", textKey: "fedToGrid" },
  ];

  const hasAnything = rows.some((row) => {
    const entry = payload.find((p) => p.dataKey === row.key);
    return entry && entry.value !== null && entry.value !== undefined;
  });

  return (
    <div className={CHART_TOOLTIP_CLASSNAME}>
      <p className="font-medium text-slate-300">{labelFormatter(label)}</p>

      {rows.map(({ key, textKey }) => {
        const entry = payload.find((p) => p.dataKey === key);

        if (!entry || entry.value === null || entry.value === undefined) {
          return null;
        }

        return (
          <p key={key} className="mt-1 flex items-center gap-1.5" style={{ color: entry.color }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: entry.color }} />
            {Math.abs(entry.value).toFixed(2)} {unit} {t(textKey as never)}
          </p>
        );
      })}

      {!hasAnything && <p className="mt-1 text-slate-500">{t("noData")}</p>}
    </div>
  );
}

const Y_AXES: Record<"kW" | "kWh", ChartFrameYAxis[]> = {
  kW: [{ yAxisId: "power", unitLabel: "kW" }],
  kWh: [{ yAxisId: "power", unitLabel: "kWh" }],
};

export function LiveEnergyChart({
  data,
  nowAnnotation,
  unit = "kW",
  xAxisUnit = "time",
}: LiveEnergyChartProps) {
  const t = useTranslations("dashboard.liveEnergy");

  // Producer Topology milestone: a plant with no real meter never has a
  // real consumption/import/export reading at any timestamp, in any period
  // — every point already has `null` for these three fields (see
  // `dashboard-data.ts`'s `toEnergyFlowPoint`/`buildPeriodChartSeries`).
  // Detected directly from the data already passed in, not a new prop:
  // the chart becomes a plain real-time PV production widget for such a
  // plant, instead of three permanently-empty lines/legend entries next to
  // the one real line. A plant with a real meter (Atlanta) always has at
  // least one real point for these fields and is completely unaffected.
  const hasGridData = data.some(
    (point) => point.consumptionKw !== null || point.gridImportKw !== null || point.gridExportKw !== null,
  );

  const now = Date.now();
  const domainStart = data[0]?.time;
  const domainEnd = data[data.length - 1]?.time;
  const nowInRange =
    domainStart !== undefined && domainEnd !== undefined && now >= domainStart && now <= domainEnd;
  // Fixed 90-minute ticks (01:30, 03:00, ...) only apply to a single
  // calendar day ("time" - Today), matching Market's own price chart —
  // `data[0].time` is always that day's local midnight
  // (`dashboard-data.ts`'s `buildFullDayChartSeries`). Week/Month/Year
  // charts fall back to recharts' own automatic tick placement instead.
  const xTicks =
    xAxisUnit === "time" && domainStart !== undefined
      ? computeFixedChartTicks(domainStart)
      : undefined;
  const xAxisTickFormatter = X_AXIS_TICK_FORMATTERS[xAxisUnit];

  // Presentation-only transform: `data` itself (from `dashboard-data.ts`)
  // keeps `gridImportKw` as the real positive magnitude — only this
  // rendered copy negates it, so "Import from Grid" plots below the X
  // axis (per this milestone's explicit requirement) without changing the
  // underlying value.
  const chartData = data.map((point) => ({
    ...point,
    gridImportNegKw: point.gridImportKw !== null ? -point.gridImportKw : null,
  }));

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-1 text-xs">
        <span className="flex items-center gap-1.5 text-slate-300">
          <span className="h-0.5 w-3 rounded-full bg-emerald-400" />
          {t("pvOutput")}
        </span>
        {hasGridData && (
          <>
            <span className="flex items-center gap-1.5 text-slate-300">
              <span className="h-0.5 w-3 rounded-full bg-amber-400" />
              {t("totalConsumption")}
            </span>
            <span className="flex items-center gap-1.5 text-slate-300">
              <span className="h-0.5 w-3 rounded-full bg-orange-400" />
              {t("importFromGrid")}
            </span>
            <span className="flex items-center gap-1.5 text-slate-300">
              <span className="h-0.5 w-3 rounded-full bg-blue-400" />
              {t("fedToGrid")}
            </span>
          </>
        )}
      </div>

      <div className="mt-2 min-h-0 flex-1">
        <ChartFrame
          data={chartData}
          yAxes={Y_AXES[unit]}
          tooltipContent={<ChartTooltip unit={unit} labelFormatter={xAxisTickFormatter} />}
          hasAnnotationMargin={Boolean(nowAnnotation)}
          xTicks={xTicks}
          tickFormatter={xAxisTickFormatter}
        >
          {/*
            Historical Analytics Refinement milestone: a subtle y=0
            reference line for Week/Month/Year only - a historical chart
            with only positive energy totals otherwise has no visible
            baseline to read the bars/lines against, making it look flatter
            than it is. Today is untouched (it already reads clearly
            against its live NOW marker). Thin, low-opacity gray, matching
            this chart family's existing axis-tick color (`#64748b`, see
            `chart-style.ts`'s `CHART_AXIS_TICK`) rather than introducing a
            new color token.
          */}
          {xAxisUnit !== "time" && (
            <ReferenceLine yAxisId="power" y={0} stroke="#64748b" strokeOpacity={0.35} strokeWidth={1} />
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

          {hasGridData && (
            <Line
              yAxisId="power"
              type="monotone"
              dataKey="consumptionKw"
              stroke="#fbbf24"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3.5 }}
              connectNulls={false}
              isAnimationActive
              animationDuration={700}
            />
          )}
          {/* Rendered after (so visually above) consumptionKw - see this
              file's own top doc comment: keeps the PV line visible when the
              two values are close, since later SVG siblings paint on top. */}
          <Line
            yAxisId="power"
            type="monotone"
            dataKey="pvKw"
            stroke="#34d399"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3.5 }}
            connectNulls={false}
            isAnimationActive
            animationDuration={700}
          />
          {hasGridData && (
            <>
              <Line
                yAxisId="power"
                type="monotone"
                dataKey="gridImportNegKw"
                stroke="#fb923c"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3.5 }}
                connectNulls={false}
                isAnimationActive
                animationDuration={700}
              />
              <Line
                yAxisId="power"
                type="monotone"
                dataKey="gridExportKw"
                stroke="#60a5fa"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3.5 }}
                connectNulls={false}
                isAnimationActive
                animationDuration={700}
              />
            </>
          )}
        </ChartFrame>
      </div>
    </div>
  );
}
