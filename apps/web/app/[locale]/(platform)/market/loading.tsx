/**
 * Historical Data Auto-Import milestone. Same role as
 * `dashboard/loading.tsx` - shown automatically while `page.tsx` awaits
 * `ensureTelemetryFresh`/`getMarketPageData`/`getProductionPageData`, so a
 * historical day that needs importing shows a loading skeleton instead of
 * ever flashing "no market data" mid-import.
 *
 * UX polish fix: see `dashboard/loading.tsx`'s matching doc comment for the
 * full explanation - this skeleton had the identical two bugs: a hand-rolled
 * `mx-auto` wrapper instead of the shared `PageContainer` (`mr-auto`, a real
 * horizontal position mismatch on any viewport wider than 1280px), and a
 * bottom row sized `h-40` instead of the ~280px CSS Grid `align-items:
 * stretch` actually settles it to (governed by `MarketEventLog`'s own fixed
 * height). Every class below is copied directly from the real JSX it stands
 * in for.
 */
import { PageContainer } from "@/components/platform/layout/PageContainer";

function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-2xl border border-white/10 bg-white/[0.03] ${className}`}
    />
  );
}

export default function MarketLoading() {
  return (
    <PageContainer className="space-y-3">
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          {/* Same frame MarketToolbar itself renders (p-2.5 + h-8 controls) - see MarketToolbar.tsx. */}
          <SkeletonCard className="h-[53px] w-full" />
        </div>
      </div>

      <section className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <SkeletonCard key={index} className="h-24" />
        ))}
      </section>

      {/* Same frame (p-3.5 sm:p-4 + title block) and the exact same responsive
          chart height (h-[200px] sm:h-[280px] lg:h-[320px] xl:h-[380px])
          page.tsx's Price & Export chart section uses. */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:p-4">
        <SkeletonCard className="h-3.5 w-32" />
        <SkeletonCard className="mt-1.5 h-3 w-48" />
        <div className="mt-2.5 h-[200px] sm:h-[280px] lg:h-[320px] xl:h-[380px]">
          <SkeletonCard className="h-full w-full" />
        </div>
      </div>

      {/* Bottom row settles to ~280px via CSS Grid stretch (MarketEventLog's own
          fixed h-[280px] governs it - the other three cards have no fixed
          height of their own), not the 160px this skeleton previously used. */}
      <section className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <SkeletonCard key={index} className="h-[280px]" />
        ))}
      </section>
    </PageContainer>
  );
}
