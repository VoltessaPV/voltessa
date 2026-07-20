"use client";

import { Line, ReferenceLine } from "recharts";

import type { EnergyFlowPoint } from "@/app/(platform)/dashboard/dashboard-data";
import { ChartFrame, type ChartFrameYAxis } from "@/components/charts/ChartFrame";
import { CHART_TOOLTIP_CLASSNAME, formatSofiaTime } from "@/components/charts/chart-style";
import { NowLabel } from "@/components/charts/NowMarker";

type LiveEnergyChartProps = {
  data: EnergyFlowPoint[];
  /** Same live reading `energyFlow` uses — never a second real-time read, see `dashboard-data.ts`. */
  nowAnnotation?: string;
};

const Y_AXES: ChartFrameYAxis[] = [{ yAxisId: "power", unitLabel: "kW" }];

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
 */
function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number | null; dataKey: string; color: string }>;
  label?: number;
}) {
  if (!active || !payload || payload.length === 0 || label === undefined) {
    return null;
  }

  const rows: Array<{ key: string; text: string }> = [
    { key: "pvKw", text: "PV production" },
    { key: "consumptionKw", text: "Consumption" },
    { key: "gridImportKw", text: "Grid import" },
    { key: "gridExportKw", text: "Grid export" },
  ];

  const hasAnything = rows.some((row) => {
    const entry = payload.find((p) => p.dataKey === row.key);
    return entry && entry.value !== null && entry.value !== undefined;
  });

  return (
    <div className={CHART_TOOLTIP_CLASSNAME}>
      <p className="font-medium text-slate-300">{formatSofiaTime(label)}</p>

      {rows.map(({ key, text }) => {
        const entry = payload.find((p) => p.dataKey === key);

        if (!entry || entry.value === null || entry.value === undefined) {
          return null;
        }

        return (
          <p key={key} className="mt-1 flex items-center gap-1.5" style={{ color: entry.color }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: entry.color }} />
            {entry.value.toFixed(2)} kW {text}
          </p>
        );
      })}

      {!hasAnything && <p className="mt-1 text-slate-500">No data</p>}
    </div>
  );
}

export function LiveEnergyChart({ data, nowAnnotation }: LiveEnergyChartProps) {
  const now = Date.now();
  const domainStart = data[0]?.time;
  const domainEnd = data[data.length - 1]?.time;
  const nowInRange =
    domainStart !== undefined && domainEnd !== undefined && now >= domainStart && now <= domainEnd;

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-1 text-xs">
        <span className="flex items-center gap-1.5 text-slate-300">
          <span className="h-0.5 w-3 rounded-full bg-emerald-400" />
          PV Production
        </span>
        <span className="flex items-center gap-1.5 text-slate-300">
          <span className="h-0.5 w-3 rounded-full bg-slate-300" />
          Consumption
        </span>
        <span className="flex items-center gap-1.5 text-slate-300">
          <span className="h-0.5 w-3 rounded-full bg-cyan-400" />
          Grid Import
        </span>
        <span className="flex items-center gap-1.5 text-slate-300">
          <span className="h-0.5 w-3 rounded-full bg-violet-400" />
          Grid Export
        </span>
      </div>

      <div className="mt-2 min-h-0 flex-1">
        <ChartFrame
          data={data}
          yAxes={Y_AXES}
          tooltipContent={<ChartTooltip />}
          hasAnnotationMargin={Boolean(nowAnnotation)}
        >
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
          <Line
            yAxisId="power"
            type="monotone"
            dataKey="consumptionKw"
            stroke="#cbd5e1"
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
            dataKey="gridImportKw"
            stroke="#22d3ee"
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
            stroke="#a78bfa"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3.5 }}
            connectNulls={false}
            isAnimationActive
            animationDuration={700}
          />
        </ChartFrame>
      </div>
    </div>
  );
}
