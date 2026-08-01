/**
 * Historical Data Auto-Import milestone. Same role as
 * `dashboard/loading.tsx` - shown automatically while `page.tsx` awaits
 * `ensureHistoricalDayAvailable`/`ensureTelemetryFresh`/`getMarketPageData`,
 * so a historical day that needs importing shows a loading skeleton instead
 * of ever flashing "no market data" mid-import.
 */
function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-2xl border border-white/10 bg-white/[0.03] ${className}`}
    />
  );
}

export default function MarketLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-3">
      <SkeletonCard className="h-10 w-full" />

      <section className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <SkeletonCard key={index} className="h-24" />
        ))}
      </section>

      <SkeletonCard className="h-[280px]" />

      <section className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <SkeletonCard key={index} className="h-40" />
        ))}
      </section>
    </div>
  );
}
