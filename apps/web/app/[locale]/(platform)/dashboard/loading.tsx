/**
 * Historical Data Auto-Import milestone. Next.js route-level loading UI,
 * shown automatically while `page.tsx` awaits `ensureHistoricalDayAvailable`
 * / `ensureTelemetryFresh` / `getDashboardPageData` - covers the "slightly
 * longer loading state" this milestone explicitly allows for a historical
 * day that needs importing, without ever rendering a "no historical data"
 * empty state mid-import. Pure markup, matching the real page's own
 * card/grid shapes (`page.tsx`) so nothing shifts layout when the real
 * content swaps in - same `animate-pulse`/`bg-white/[0.03]` treatment
 * `ChartSkeleton` already uses elsewhere on this page.
 */
function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-2xl border border-white/10 bg-white/[0.03] ${className}`}
    />
  );
}

export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-3">
      <SkeletonCard className="h-10 w-full" />

      <section className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <SkeletonCard key={index} className="h-24" />
        ))}
      </section>

      <section className="grid gap-2.5 lg:grid-cols-[30%_1fr]">
        <SkeletonCard className="h-[280px]" />
        <SkeletonCard className="h-[280px]" />
      </section>

      <section className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <SkeletonCard key={index} className="h-40" />
        ))}
      </section>
    </div>
  );
}
