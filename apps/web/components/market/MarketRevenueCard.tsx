import type { RevenueSummaryData } from "@/app/(platform)/market/market-data";

type MarketRevenueCardProps = {
  revenue: RevenueSummaryData;
};

/** Minimal hand-rolled sparkline — no charting-library client boundary needed for a static trend line. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return null;
  }

  const width = 240;
  const height = 40;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const areaPoints = `0,${height} ${points} ${width},${height}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-10 w-full"
      preserveAspectRatio="none"
    >
      <polyline points={areaPoints} fill="#34d399" fillOpacity={0.08} />
      <polyline
        points={points}
        fill="none"
        stroke="#34d399"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Today's Revenue card. Prices are real ENTSO-E day-ahead values; export
 * volume is illustrative (see `illustrative-production.ts`) pending real
 * FusionSolar production data — disclosed via the caption below the
 * numbers rather than presented as if fully real.
 */
export function MarketRevenueCard({ revenue }: MarketRevenueCardProps) {
  const sparklineValues = revenue.sparkline.filter((_, index) => index % 4 === 0);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)]">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
        Today&apos;s Revenue
      </p>

      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold leading-none tracking-tight text-white tabular-nums">
          {revenue.totalRevenue.toLocaleString("en-US")}
        </span>
        <span className="text-sm text-slate-500">{revenue.currency}</span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3 border-t border-white/10 pt-3">
        <div>
          <p className="text-[11px] text-slate-500">Exported</p>
          <p className="mt-1 text-sm font-medium text-white tabular-nums">
            {revenue.exportedEnergyMwh} MWh
          </p>
        </div>

        <div>
          <p className="text-[11px] text-slate-500">Avg. Price</p>
          <p className="mt-1 text-sm font-medium text-white tabular-nums">
            {revenue.averageSellingPrice}
          </p>
        </div>

        <div>
          <p className="text-[11px] text-slate-500">Revenue/Exported MWh</p>
          <p className="mt-1 text-sm font-medium text-white tabular-nums">
            {revenue.revenuePerExportedMwh}
          </p>
        </div>
      </div>

      <div className="mt-3">
        <Sparkline values={sparklineValues} />
      </div>

      <p className="mt-2 text-[10px] text-slate-600">
        Prices are real (ENTSO-E). Export volume is illustrative pending
        live FusionSolar production data.
      </p>
    </div>
  );
}
