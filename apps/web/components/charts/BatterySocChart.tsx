"use client";

import { Line } from "recharts";

import { ChartFrame, type ChartFrameYAxis } from "@/components/charts/ChartFrame";
import { CHART_TOOLTIP_CLASSNAME, computeFixedChartTicks, formatSofiaDate, formatSofiaTime } from "@/components/charts/chart-style";
import type { SocPoint } from "@/lib/market-price/chart-aggregation";

/**
 * Battery Digital Twin UI milestone. SOC is state, not an energy flow - this
 * chart only ever renders `simulatedSocChart` exactly as
 * `aggregateSocSeriesForChart` produced it (last-value-per-bucket, never
 * summed/averaged - see that function's doc comment). No battery scenario
 * for "Current" exists, so this chart only ever appears once, for
 * "Simulated". Reuses `ChartFrame` directly - the same shell
 * `MarketPriceChart` renders through - rather than a second chart engine.
 */
type BatterySocChartProps = {
  series: SocPoint[];
  batteryCapacityKwh: number;
  /** Same meaning as `MarketPriceChart`'s own prop - "time" for a single native day, "day" once the chart is hourly/daily-bucketed. */
  xAxisUnit?: "time" | "day";
};

type SocDatum = {
  time: number;
  socKwh: number | null;
};

function SocTooltip({
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

  const socKwh = payload.find((entry) => entry.dataKey === "socKwh")?.value ?? null;

  return (
    <div className={CHART_TOOLTIP_CLASSNAME}>
      <p className="font-medium text-slate-300">{labelFormatter(label)}</p>
      {socKwh !== null ? (
        <p className="mt-1 flex items-center gap-1.5 text-amber-400">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          {socKwh.toFixed(2)} kWh
        </p>
      ) : (
        <p className="mt-1 text-slate-500">No data</p>
      )}
    </div>
  );
}

export function BatterySocChart({ series, batteryCapacityKwh, xAxisUnit = "time" }: BatterySocChartProps) {
  const data: SocDatum[] = series.map((point) => ({ time: point.intervalStart.getTime(), socKwh: point.socKwh }));

  const domainStart = data[0]?.time;
  const xTicks = xAxisUnit === "time" && domainStart !== undefined ? computeFixedChartTicks(domainStart) : undefined;
  const xAxisTickFormatter = xAxisUnit === "time" ? formatSofiaTime : formatSofiaDate;

  const yAxes: ChartFrameYAxis[] = [
    {
      yAxisId: "soc",
      unitLabel: "kWh",
      domain: [0, Math.max(batteryCapacityKwh, 1)],
      allowDataOverflow: true,
    },
  ];

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-1 text-xs">
        <span className="flex items-center gap-1.5 text-slate-300">
          <span className="h-0.5 w-3 rounded-full bg-amber-400" />
          Battery SOC
        </span>
      </div>

      <div className="mt-2 min-h-0 flex-1">
        <ChartFrame
          data={data}
          yAxes={yAxes}
          tooltipContent={<SocTooltip labelFormatter={xAxisTickFormatter} />}
          xTicks={xTicks}
          tickFormatter={xAxisTickFormatter}
        >
          <Line
            yAxisId="soc"
            type="monotone"
            dataKey="socKwh"
            stroke="#fbbf24"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3.5, fill: "#fcd34d" }}
            connectNulls={false}
            isAnimationActive
            animationDuration={700}
          />
        </ChartFrame>
      </div>
    </div>
  );
}
