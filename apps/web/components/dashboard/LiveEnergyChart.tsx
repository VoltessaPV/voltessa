"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { EnergyFlowPoint } from "@/app/(platform)/dashboard/dashboard-data";
import {
  CHART_AXIS_LINE,
  CHART_AXIS_TICK,
  CHART_GRID_STROKE,
  CHART_MARGIN,
  CHART_MARGIN_WITH_ANNOTATION,
  CHART_TOOLTIP_CLASSNAME,
  formatSofiaTime,
} from "@/components/charts/chart-style";
import { NowLabel } from "@/components/charts/NowMarker";

type LiveEnergyChartProps = {
  data: EnergyFlowPoint[];
  /** Same live reading `energyFlow` uses — never a second real-time read, see `dashboard-data.ts`. */
  nowAnnotation?: string;
};

/**
 * Today's PV production / consumption / grid import / grid export power
 * (kW) — architecturally identical to Market's `MarketPriceChart` (Design-
 * System Consistency milestone: same grid/axis/tooltip/legend/NOW-marker
 * building blocks, imported from `components/charts/*`, not a second,
 * independently-styled chart). Only the plotted series differ: this is
 * real-time plant power, never price or exported energy (that split is
 * Market's, per the Mathematical Correctness milestone). Full 00:00-24:00
 * timeline, exactly like Market's price chart - `data` already covers the
 * whole calendar day with `null` for anything not yet happened (see
 * `dashboard-data.ts`'s `buildFullDayChartSeries`). Import and export are
 * mutually exclusive at every timestamp (`energy-metrics.ts`'s
 * `exportKw = max(meterKw, 0)` / `importKw = max(-meterKw, 0)`) — there is
 * only one grid connection, rendered as two lines because a single signed
 * line would need a zero-crossing legend of its own to read at a glance.
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
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={nowAnnotation ? CHART_MARGIN_WITH_ANNOTATION : CHART_MARGIN}
          >
            <CartesianGrid vertical={false} stroke={CHART_GRID_STROKE} />

            <XAxis
              dataKey="time"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={formatSofiaTime}
              tick={CHART_AXIS_TICK}
              tickLine={false}
              axisLine={CHART_AXIS_LINE}
              tickMargin={10}
              minTickGap={48}
            />

            <YAxis
              tick={CHART_AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={44}
              tickMargin={8}
              label={{
                value: "kW",
                angle: -90,
                position: "insideLeft",
                fill: "#64748b",
                fontSize: 10,
              }}
            />

            <Tooltip content={<ChartTooltip />} />

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
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
