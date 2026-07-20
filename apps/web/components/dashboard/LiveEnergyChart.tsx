"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { EnergyFlowPoint } from "@/app/(platform)/dashboard/dashboard-data";

type LiveEnergyChartProps = {
  data: EnergyFlowPoint[];
};

/**
 * Today's PV production / consumption / grid import / grid export power
 * (kW) — the Dashboard's own operational chart, visually consistent with
 * Market's `MarketPriceChart` (same grid/axis/tooltip styling, same
 * `recharts` usage) but a genuinely different chart: this one is real-time
 * plant power, never price or exported energy (that split is Market's, per
 * the Mathematical Correctness milestone). Import and export are mutually
 * exclusive at every timestamp (`energy-metrics.ts`'s
 * `exportKw = max(meterKw, 0)` / `importKw = max(-meterKw, 0)`) — there is
 * only one grid connection, rendered as two lines because a single signed
 * line would need a zero-crossing legend of its own to read at a glance.
 */
function formatSofiaTime(time: number): string {
  return new Date(time).toLocaleTimeString("en-GB", {
    timeZone: "Europe/Sofia",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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

  return (
    <div className="rounded-xl border border-white/10 bg-[#0b1020] px-3 py-2 text-xs shadow-[0_12px_28px_-16px_rgba(0,0,0,0.7)]">
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
    </div>
  );
}

export function LiveEnergyChart({ data }: LiveEnergyChartProps) {
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
          <LineChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />

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
              tick={{ fill: "#64748b", fontSize: 11 }}
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
