/**
 * Chart Loading Optimization milestone. The `<Suspense>` fallback shown
 * while a chart's own chunk (`recharts` + `ChartFrame`) is still loading —
 * see `LiveEnergyChart.dynamic.tsx` / `MarketPriceChart.dynamic.tsx`. Pure
 * markup, no client JS: a Server Component is enough since there's nothing
 * interactive about a loading placeholder. Fills its parent's existing
 * fixed-height container exactly (same container the real chart already
 * rendered into), so swapping it for the real chart causes no layout
 * shift.
 */
export function ChartSkeleton() {
  return (
    <div className="h-full w-full animate-pulse rounded-xl bg-white/[0.03]" />
  );
}
