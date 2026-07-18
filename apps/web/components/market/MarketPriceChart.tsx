"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { MarketPricePoint } from "@/app/(platform)/market/market-data";

type MarketPriceChartProps = {
  series: MarketPricePoint[];
  thresholdPrice: number;
};

type ChartDatum = {
  time: number;
  price: number | null;
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
  payload?: Array<{ value: number | null; dataKey: string }>;
  label?: number;
}) {
  if (!active || !payload || payload.length === 0 || label === undefined) {
    return null;
  }

  const price = payload.find((entry) => entry.dataKey === "price")?.value;

  return (
    <div className="rounded-xl border border-white/10 bg-[#0b1020] px-3 py-2 text-xs shadow-[0_12px_28px_-16px_rgba(0,0,0,0.7)]">
      <p className="font-medium text-slate-300">{formatSofiaTime(label)}</p>

      {price !== undefined && price !== null ? (
        <p className="mt-1 flex items-center gap-1.5 text-blue-400">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
          {price} EUR/MWh
        </p>
      ) : (
        <p className="mt-1 text-slate-500">No price data</p>
      )}
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

/** Custom label for the NOW marker — a small pill badge with a pulsing dot, like a live terminal cursor. */
function NowLabel(props: { viewBox?: { x?: number; y?: number } }) {
  const { viewBox } = props;
  if (!viewBox || viewBox.x === undefined || viewBox.y === undefined) {
    return null;
  }

  return (
    <g transform={`translate(${viewBox.x}, ${viewBox.y - 6})`}>
      <rect x={-20} y={-16} width={40} height={16} rx={8} fill="#0891b2" />
      <circle cx={-11} cy={-8} r={2.5} fill="#5eead4">
        <animate
          attributeName="opacity"
          values="1;0.35;1"
          dur="1.6s"
          repeatCount="indefinite"
        />
      </circle>
      <text x={4} y={-4} textAnchor="middle" fontSize={9} fontWeight={700} fill="#ecfeff">
        NOW
      </text>
    </g>
  );
}

/**
 * The Market page's hero chart — real ENTSO-E day-ahead price (blue),
 * the export-profitability threshold (amber), a live NOW marker, and
 * elegant gradient-filled bands over export-enabled intervals. Gaps in
 * the price line are genuine missing intervals (`connectNulls={false}`),
 * never fabricated or interpolated.
 *
 * Visual language reserved for later, not implemented yet: a cyan dot
 * marker style is reserved for automation-engine decisions, a violet
 * accent for trader schedules, and Huawei command markers would sit as
 * point annotations along the same time axis — no code for any of that
 * exists here yet; only the color/marker vocabulary is established so
 * adding them later extends this file instead of restyling it.
 */
export function MarketPriceChart({
  series,
  thresholdPrice,
}: MarketPriceChartProps) {
  const data: ChartDatum[] = series.map((point) => ({
    time: point.timestamp.getTime(),
    price: point.price,
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
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-1 text-xs">
        <span className="flex items-center gap-1.5 text-slate-300">
          <span className="h-0.5 w-3 rounded-full bg-blue-400" />
          Day-ahead price
        </span>

        <span className="h-3 w-px bg-white/10" />

        <span className="flex items-center gap-1.5 text-slate-500">
          <span className="h-0.5 w-3 rounded-full border-t border-dashed border-amber-400" />
          Export threshold
        </span>

        <span className="flex items-center gap-1.5 text-slate-500">
          <span className="h-2.5 w-2.5 rounded-sm bg-gradient-to-b from-emerald-400/40 to-emerald-400/0" />
          Export window
        </span>
      </div>

      <div className="mt-2 min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 30, right: 12, bottom: 0, left: 0 }}
          >
            <defs>
              <linearGradient id="exportBandFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#34d399" stopOpacity={0.16} />
                <stop offset="100%" stopColor="#34d399" stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />

            {bands.map((band) => (
              <ReferenceArea
                key={band.start}
                x1={band.start}
                x2={band.end}
                fill="url(#exportBandFill)"
                stroke="#34d399"
                strokeOpacity={0.25}
                strokeWidth={1}
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
              tickMargin={10}
              minTickGap={48}
            />

            <YAxis
              tick={{ fill: "#64748b", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={44}
              tickMargin={8}
            />

            <Tooltip content={<ChartTooltip />} />

            <ReferenceLine
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
                label={<NowLabel />}
              />
            )}

            <Line
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
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
