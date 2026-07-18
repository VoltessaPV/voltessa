"use client";

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { MarketPricePoint } from "@/app/(platform)/market/mock-data";

type MarketPriceChartProps = {
  series: MarketPricePoint[];
};

type ChartDatum = {
  time: number;
  price: number;
  exportPowerMw: number;
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

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string }>;
  label?: number;
}) {
  if (!active || !payload || payload.length === 0 || label === undefined) {
    return null;
  }

  const price = payload.find((entry) => entry.dataKey === "price")?.value;
  const exportPower = payload.find(
    (entry) => entry.dataKey === "exportPowerMw",
  )?.value;

  return (
    <div className="rounded-xl border border-white/10 bg-[#0b1020] px-3 py-2 text-xs shadow-[0_12px_28px_-16px_rgba(0,0,0,0.7)]">
      <p className="font-medium text-slate-300">{formatSofiaTime(label)}</p>

      {price !== undefined && (
        <p className="mt-1 flex items-center gap-1.5 text-blue-400">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
          {price} EUR/MWh
        </p>
      )}

      {exportPower !== undefined && (
        <p className="mt-0.5 flex items-center gap-1.5 text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {exportPower} MW
        </p>
      )}
    </div>
  );
}

/**
 * Multi-series market chart — currently: day-ahead price (blue) and export
 * power (green), with a NOW marker and translucent bands over
 * export-enabled intervals. Built to take more series later (e.g. a
 * forecast line) without restructuring: each series is one <Line>, driven
 * by the same `time`-keyed data array.
 */
export function MarketPriceChart({ series }: MarketPriceChartProps) {
  const data: ChartDatum[] = series.map((point) => ({
    time: point.timestamp.getTime(),
    price: point.price,
    exportPowerMw: point.exportPowerMw,
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded-full bg-blue-400" />
          Day-ahead price
        </span>

        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded-full bg-emerald-400" />
          Export power
        </span>

        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-emerald-400/20" />
          Export enabled
        </span>
      </div>

      <div className="mt-2 min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 12, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              vertical={false}
              stroke="rgba(255,255,255,0.06)"
            />

            {bands.map((band) => (
              <ReferenceArea
                key={band.start}
                yAxisId="price"
                x1={band.start}
                x2={band.end}
                fill="#34d399"
                fillOpacity={0.07}
                stroke="none"
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
              minTickGap={48}
            />

            <YAxis
              yAxisId="price"
              tick={{ fill: "#64748b", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={40}
            />

            <YAxis
              yAxisId="export"
              orientation="right"
              tick={{ fill: "#64748b", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={36}
            />

            <Tooltip content={<ChartTooltip />} />

            {nowInRange && (
              <ReferenceLine
                yAxisId="price"
                x={now}
                stroke="#f8fafc"
                strokeOpacity={0.35}
                strokeDasharray="3 3"
                label={{
                  value: "NOW",
                  position: "top",
                  fill: "#94a3b8",
                  fontSize: 10,
                }}
              />
            )}

            <Line
              yAxisId="price"
              type="monotone"
              dataKey="price"
              stroke="#60a5fa"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive
              animationDuration={800}
            />

            <Line
              yAxisId="export"
              type="monotone"
              dataKey="exportPowerMw"
              stroke="#34d399"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive
              animationDuration={800}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
