import type { DistributionBucket } from "@/app/(platform)/market/market-data";

type MarketDistributionProps = {
  buckets: DistributionBucket[];
};

const RING_COLOR_HEX: Record<string, string> = {
  "bg-red-400": "#f87171",
  "bg-emerald-400": "#34d399",
  "bg-blue-400": "#60a5fa",
  "bg-amber-400": "#fbbf24",
};

const SIZE = 112;
const STROKE_WIDTH = 13;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Static SVG ring chart (stacked circles + stroke-dasharray) — no charting-library client boundary needed. */
export function MarketDistribution({ buckets }: MarketDistributionProps) {
  let cumulativePercentage = 0;

  const dominant: DistributionBucket | undefined = buckets.reduce<
    DistributionBucket | undefined
  >(
    (max, bucket) =>
      !max || bucket.percentage > max.percentage ? bucket : max,
    undefined,
  );

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)]">
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
        Price Distribution
      </p>

      <div className="mt-3 flex items-center gap-5">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={SIZE}
          height={SIZE}
          className="shrink-0"
        >
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={STROKE_WIDTH}
          />

          {buckets.map((bucket) => {
            const dash = (bucket.percentage / 100) * CIRCUMFERENCE;
            const offset = -((cumulativePercentage / 100) * CIRCUMFERENCE);
            cumulativePercentage += bucket.percentage;

            return (
              <circle
                key={bucket.label}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke={RING_COLOR_HEX[bucket.colorClass] ?? "#64748b"}
                strokeWidth={STROKE_WIDTH}
                strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                strokeDashoffset={offset}
                strokeLinecap="butt"
                transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
              />
            );
          })}

          {dominant && (
            <>
              <text
                x={SIZE / 2}
                y={SIZE / 2 - 3}
                textAnchor="middle"
                className="fill-white text-[16px] font-semibold"
              >
                {dominant.percentage}%
              </text>
              <text
                x={SIZE / 2}
                y={SIZE / 2 + 13}
                textAnchor="middle"
                className="fill-slate-500 text-[9px] uppercase tracking-wide"
              >
                {dominant.label}
              </text>
            </>
          )}
        </svg>

        <div className="min-w-0 flex-1 space-y-1.5">
          {buckets.map((bucket) => (
            <div
              key={bucket.label}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="flex items-center gap-2 text-slate-400">
                <span
                  className={`h-2 w-2 rounded-full ${bucket.colorClass}`}
                />
                {bucket.label}
                <span className="text-slate-600">{bucket.rangeLabel}</span>
              </span>

              <span className="font-medium tabular-nums text-white">
                {bucket.percentage}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
