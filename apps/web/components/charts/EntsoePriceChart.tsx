"use client";

import { Brush, Line, ReferenceDot, ReferenceLine, Scatter } from "recharts";

import type { EntsoeDecision } from "@/app/admin/digital-twin/entsoe-price-actions";
import type { MarketPricePoint } from "@/app/[locale]/(platform)/market/market-data";
import { ChartFrame, type ChartFrameYAxis } from "@/components/charts/ChartFrame";
import { CHART_TOOLTIP_CLASSNAME, computeFixedChartTicks, formatSofiaDate, formatSofiaTime } from "@/components/charts/chart-style";
import { NowLabel } from "@/components/charts/NowMarker";
import { computeMultipleOf50Ticks } from "@/components/market/MarketPriceChart";

/**
 * ENTSO-E Price Visualization milestone. A forward-looking day-ahead price
 * chart, independent of `MarketPriceChart` (which is Market's own
 * historical/today price+export view) - this one is purpose-built for
 * "what will electricity cost, and what would the optimizer do about it,"
 * over a selectable horizon up to 7 days. Reuses `ChartFrame` (the one
 * chart shell every recharts chart in the app renders through) and
 * `chart-style.ts`'s shared formatters/tokens - only the marks plotted here
 * are new.
 *
 * Layered by construction: each visual layer (price line, min/max markers,
 * current-hour marker, day separators, the optimizer-decision overlay) is
 * its own independent, optional prop/series - exactly the pattern
 * `MarketPriceChart`/`BatterySocChart` already use for their own optional
 * overlays (export energy, SOC). Adding a future overlay (PV forecast,
 * consumption forecast, battery SOC, grid import/export, AI recommendations)
 * means adding one more optional prop and one more `Line`/`Scatter` here,
 * never restructuring the ones that already exist.
 */
export type EntsoePriceChartProps = {
  series: MarketPricePoint[];
  /** Optimizer decisions overlay - omitted entirely (no markers, no legend entry) when no battery scenario is configured. */
  decisions?: EntsoeDecision[];
  /** "time" for a single-day horizon (Today/Tomorrow), "day" for a multi-day horizon (Next 3/7 days) - same convention as `MarketPriceChart`'s own `xAxisUnit`. */
  xAxisUnit: "time" | "day";
};

type PriceDatum = {
  time: number;
  price: number | null;
  chargePrice: number | null;
  dischargePrice: number | null;
  idlePrice: number | null;
};

const DECISION_COLOR: Record<EntsoeDecision["action"], string> = {
  charge: "#34d399",
  discharge: "#f87171",
  idle: "#94a3b8",
};

function buildData(series: MarketPricePoint[], decisions: EntsoeDecision[]): PriceDatum[] {
  const decisionByTime = new Map(decisions.map((d) => [d.time, d.action]));

  return series.map((point) => {
    const time = point.timestamp.getTime();
    const action = decisionByTime.get(time);
    return {
      time,
      price: point.price,
      chargePrice: action === "charge" ? point.price : null,
      dischargePrice: action === "discharge" ? point.price : null,
      idlePrice: action === "idle" ? point.price : null,
    };
  });
}

/** One `ReferenceLine` per calendar-day boundary strictly inside the domain - visually separates the horizon into its constituent days without touching the data itself. */
function computeDayBoundaries(data: PriceDatum[]): number[] {
  if (data.length < 2) {
    return [];
  }
  const domainStart = data[0]!.time;
  const domainEnd = data[data.length - 1]!.time;

  const boundaries: number[] = [];
  const firstMidnight = new Date(domainStart);
  firstMidnight.setUTCHours(0, 0, 0, 0);

  for (let t = firstMidnight.getTime(); t <= domainEnd; t += 24 * 60 * 60 * 1000) {
    if (t > domainStart && t < domainEnd) {
      boundaries.push(t);
    }
  }
  return boundaries;
}

function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
}: {
  active?: boolean;
  payload?: Array<{ value: number | null; dataKey: string }>;
  label?: number;
  labelFormatter: (time: number) => string;
}) {
  if (!active || !payload || payload.length === 0 || label === undefined) {
    return null;
  }

  const price = payload.find((entry) => entry.dataKey === "price")?.value ?? null;
  const action =
    (["chargePrice", "dischargePrice", "idlePrice"] as const)
      .map((key) => (payload.find((entry) => entry.dataKey === key)?.value !== null ? key : null))
      .find((key) => key !== null) ?? null;
  const actionLabel = action === "chargePrice" ? "Charge" : action === "dischargePrice" ? "Discharge" : action === "idlePrice" ? "Idle" : null;

  return (
    <div className={CHART_TOOLTIP_CLASSNAME}>
      <p className="font-medium text-slate-300">{labelFormatter(label)}</p>
      {price !== null && (
        <p className="mt-1 flex items-center gap-1.5 text-blue-400">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
          {price} EUR/MWh
        </p>
      )}
      {actionLabel && (
        <p className="mt-1 flex items-center gap-1.5" style={{ color: DECISION_COLOR[action === "chargePrice" ? "charge" : action === "dischargePrice" ? "discharge" : "idle"] }}>
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: DECISION_COLOR[action === "chargePrice" ? "charge" : action === "dischargePrice" ? "discharge" : "idle"] }}
          />
          {actionLabel}
        </p>
      )}
      {price === null && !actionLabel && <p className="mt-1 text-slate-500">No data</p>}
    </div>
  );
}

export function EntsoePriceChart({ series, decisions = [], xAxisUnit }: EntsoePriceChartProps) {
  const data = buildData(series, decisions);
  const hasDecisions = decisions.length > 0;

  const knownPrices = series.map((p) => p.price).filter((p): p is number => p !== null);
  const minPrice = knownPrices.length > 0 ? Math.min(...knownPrices) : null;
  const maxPrice = knownPrices.length > 0 ? Math.max(...knownPrices) : null;
  const minPoint = minPrice !== null ? data.find((d) => d.price === minPrice) : undefined;
  const maxPoint = maxPrice !== null ? data.find((d) => d.price === maxPrice) : undefined;

  const domain: [number, number] =
    minPrice !== null && maxPrice !== null ? [minPrice < 0 ? minPrice - 10 : -10, maxPrice + 20] : [-10, 20];
  const ticks = computeMultipleOf50Ticks(domain[0], domain[1]);

  const domainStart = data[0]?.time;
  const domainEnd = data[data.length - 1]?.time;
  const xTicks = xAxisUnit === "time" && domainStart !== undefined ? computeFixedChartTicks(domainStart) : undefined;
  const tickFormatter = xAxisUnit === "time" ? formatSofiaTime : formatSofiaDate;

  const now = Date.now();
  const nowInRange = domainStart !== undefined && domainEnd !== undefined && now >= domainStart && now <= domainEnd;
  const dayBoundaries = computeDayBoundaries(data);

  const yAxes: ChartFrameYAxis[] = [{ yAxisId: "price", unitLabel: "EUR/MWh", domain, allowDataOverflow: true, ticks }];

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-1 text-xs">
        <span className="flex items-center gap-1.5 text-slate-300">
          <span className="h-0.5 w-3 rounded-full bg-blue-400" />
          Day-ahead price
        </span>

        {hasDecisions && (
          <>
            <span className="h-3 w-px bg-white/10" />
            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: DECISION_COLOR.charge }} />
              Charge
            </span>
            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: DECISION_COLOR.discharge }} />
              Discharge
            </span>
            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: DECISION_COLOR.idle }} />
              Idle
            </span>
          </>
        )}
      </div>

      <div className="mt-2 min-h-0 flex-1">
        <ChartFrame
          data={data}
          yAxes={yAxes}
          tooltipContent={<ChartTooltip labelFormatter={tickFormatter} />}
          xTicks={xTicks}
          tickFormatter={tickFormatter}
        >
          <ReferenceLine yAxisId="price" y={0} stroke="#64748b" strokeWidth={1} />

          {dayBoundaries.map((boundary) => (
            <ReferenceLine key={boundary} yAxisId="price" x={boundary} stroke="#334155" strokeDasharray="3 3" strokeWidth={1} />
          ))}

          {nowInRange && (
            <ReferenceLine yAxisId="price" x={now} stroke="#22d3ee" strokeOpacity={0.55} strokeWidth={1.5} label={<NowLabel />} />
          )}

          {minPoint && (
            <ReferenceDot
              yAxisId="price"
              x={minPoint.time}
              y={minPoint.price!}
              r={4}
              fill="#4ade80"
              stroke="#0b1020"
              strokeWidth={1.5}
              label={{ value: `Min ${minPoint.price} EUR/MWh`, position: "bottom", fill: "#4ade80", fontSize: 10 }}
            />
          )}
          {maxPoint && (
            <ReferenceDot
              yAxisId="price"
              x={maxPoint.time}
              y={maxPoint.price!}
              r={4}
              fill="#fb7185"
              stroke="#0b1020"
              strokeWidth={1.5}
              label={{ value: `Max ${maxPoint.price} EUR/MWh`, position: "top", fill: "#fb7185", fontSize: 10 }}
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

          {hasDecisions && (
            <>
              <Scatter yAxisId="price" dataKey="chargePrice" fill={DECISION_COLOR.charge} shape="circle" legendType="none" />
              <Scatter yAxisId="price" dataKey="dischargePrice" fill={DECISION_COLOR.discharge} shape="circle" legendType="none" />
              <Scatter yAxisId="price" dataKey="idlePrice" fill={DECISION_COLOR.idle} shape="circle" legendType="none" />
            </>
          )}

          <Brush dataKey="time" tickFormatter={tickFormatter} height={22} stroke="#3b82f6" fill="rgba(59,130,246,0.06)" travellerWidth={8} />
        </ChartFrame>
      </div>
    </div>
  );
}
