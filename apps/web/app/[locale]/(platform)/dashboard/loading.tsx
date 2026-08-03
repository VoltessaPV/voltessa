/**
 * Historical Data Auto-Import milestone. Next.js route-level loading UI,
 * shown automatically while `page.tsx` awaits
 * `ensureTelemetryFresh`/`getDashboardPageData` - covers the "slightly
 * longer loading state" this milestone explicitly allows for a historical
 * day that needs importing, without ever rendering a "no historical data"
 * empty state mid-import. Pure markup, matching the real page's own
 * container/card/grid shapes (`page.tsx`) so nothing shifts layout when the
 * real content swaps in - same `animate-pulse`/`bg-white/[0.03]` treatment
 * `ChartSkeleton` already uses elsewhere on this page.
 *
 * UX polish fix: this skeleton had drifted out of sync with `page.tsx`'s
 * real layout across several later milestones (Fixed Header Architecture,
 * Dashboard visual refinement (FINAL PASS), Dashboard UI polish (FINAL)) -
 * it used a hand-rolled `mx-auto max-w-7xl` wrapper instead of the shared
 * `PageContainer` (which renders `mr-auto`, not `mx-auto` - a real
 * horizontal position mismatch on any viewport wider than 1280px, visible
 * as a rightward jump the instant real content replaced the skeleton), a
 * flat `h-[280px]` for the System Overview / Live Energy row instead of the
 * real cards' title-block-plus-responsive-chart shape, and `h-40` for the
 * bottom row instead of the ~280px CSS Grid `align-items: stretch` actually
 * settles that row to (governed by `MarketEventLog`'s own fixed height).
 * Every class below is copied directly from the real JSX it stands in for,
 * not re-estimated, so this cannot drift out of sync silently again without
 * also being an obvious diff against `page.tsx`.
 */
import { PageContainer } from "@/components/platform/layout/PageContainer";

function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-2xl border border-white/10 bg-white/[0.03] ${className}`}
    />
  );
}

export default function DashboardLoading() {
  return (
    <PageContainer className="space-y-3">
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          {/* Same frame MarketToolbar itself renders (p-2.5 + h-8 controls) - see MarketToolbar.tsx. */}
          <SkeletonCard className="h-[53px] w-full" />
        </div>
      </div>

      <section className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <SkeletonCard key={index} className="h-24" />
        ))}
      </section>

      {/* Same grid template as the real System Overview / Live Energy row - each
          side reproduces that card's own frame (p-3.5 sm:p-4 + a title/subtitle
          block) and the exact same responsive chart height
          (h-[220px] sm:h-[280px] lg:h-[320px] xl:h-[360px]) page.tsx uses,
          since CSS Grid's default stretch makes both cards match whichever is
          tallest at each breakpoint. */}
      <section className="grid gap-2.5 lg:grid-cols-[30%_1fr]">
        <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:p-4">
          <SkeletonCard className="h-3.5 w-32" />
          <SkeletonCard className="mt-1.5 h-3 w-48" />
          <div className="mt-2 min-h-0 flex-1">
            <SkeletonCard className="h-[220px] sm:h-[280px] lg:h-[320px] xl:h-[360px]" />
          </div>
        </div>

        <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:p-4">
          <SkeletonCard className="h-3.5 w-32" />
          <SkeletonCard className="mt-1.5 h-3 w-48" />
          <div className="mt-2.5 h-[220px] sm:h-[280px] lg:h-[320px] xl:h-[360px]">
            <SkeletonCard className="h-full w-full" />
          </div>
        </div>
      </section>

      {/* Bottom row settles to ~280px via CSS Grid stretch (MarketEventLog's own
          fixed h-[280px] governs it - the other three cards have no fixed
          height of their own), not the 160px this skeleton previously used. */}
      <section className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <SkeletonCard key={index} className="h-[280px]" />
        ))}
      </section>

      {/* Placeholder for the "Last telemetry: ..." line page.tsx always renders. */}
      <SkeletonCard className="h-4 w-48" />
    </PageContainer>
  );
}
