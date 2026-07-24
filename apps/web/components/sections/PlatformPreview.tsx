import { Suspense } from "react";

import { AppSidebar } from "@/components/platform/layout/AppSidebar";
import { ChartSkeleton } from "@/components/charts/ChartSkeleton";
import { EnergyFlowDiagram } from "@/components/dashboard/EnergyFlowDiagram";
import { GlidepathCard } from "@/components/dashboard/GlidepathCard";
import { InvertersCard } from "@/components/dashboard/InvertersCard";
import { DynamicLiveEnergyChart } from "@/components/dashboard/LiveEnergyChart.dynamic";
import { WeatherCard } from "@/components/dashboard/WeatherCard";
import { MarketEventLog } from "@/components/market/MarketEventLog";
import { MarketSummaryCard } from "@/components/market/MarketSummaryCard";
import { DEMO_DASHBOARD_DATA } from "@/lib/demo/demo-organization";

import BrowserBar from "../dashboard/BrowserBar";

/**
 * Hero browser-mockup preview. The window chrome (`BrowserBar`) and the
 * real `AppSidebar` (unmodified, no props — a nav click redirecting an
 * anonymous visitor to `/login` is expected, not a bug) are the only
 * surrounding structure. The content area is exactly
 * `app/(platform)/dashboard/page.tsx`'s own section markup (same
 * containers, spacing, grid hierarchy), fed static `DEMO_DASHBOARD_DATA`
 * instead of a database read, so this preview can't drift from the real
 * Dashboard layout. No toolbar/refresh button (out of scope — both are
 * either a live server action or navigation not part of the requested
 * fake-widget replacements), no Market/BESS/Automations — this is a single,
 * non-scrolling Dashboard screenshot only.
 *
 * `AppSidebar` is `position: fixed`, which positions relative to the
 * nearest ancestor that establishes a containing block for fixed elements
 * (a `transform`/`filter`/`will-change: transform`, etc.) — otherwise it
 * escapes straight to the real browser viewport, exactly like the real
 * `AppShell` relies on `pl-64` (not a grid) to offset content for it. The
 * `[will-change:transform]` wrapper below is that containing block, so the
 * sidebar renders trapped inside this mockup box instead of pinned to the
 * landing page's own left edge; `pl-64` reserves the same 16rem the real
 * `AppShell` reserves for it.
 */

const data = DEMO_DASHBOARD_DATA;

export function PlatformPreview() {
  return (
    <div className="w-full max-w-[980px] overflow-hidden rounded-3xl border border-slate-800 bg-[#0B1020] shadow-2xl">
      <BrowserBar />

      <div className="relative [will-change:transform]">
        <AppSidebar />

        <main className="p-2 pl-64">
          <div className="mr-auto max-w-7xl space-y-3">
            <section className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
              <MarketSummaryCard eyebrow="Yield Today" value={data.kpis.producedTodayKwh?.toFixed(1)} valueUnit="kWh" />
              <MarketSummaryCard eyebrow="Total Yield" value={data.kpis.totalYieldKwh ? (data.kpis.totalYieldKwh / 1000).toFixed(1) : undefined} valueUnit="MWh" />
              <MarketSummaryCard eyebrow="Consumption Today" value={data.kpis.consumedTodayKwh?.toFixed(1)} valueUnit="kWh" />
              <MarketSummaryCard eyebrow="Consumed from PV" value={data.kpis.consumedFromPvKwh?.toFixed(1)} valueUnit="kWh" />
              <MarketSummaryCard eyebrow="Fed to Grid" value={data.kpis.exportedTodayKwh?.toFixed(1)} valueUnit="kWh" />
              <MarketSummaryCard eyebrow="From Grid" value={data.kpis.importedTodayKwh?.toFixed(1)} valueUnit="kWh" />
            </section>

            <section className="grid gap-2.5 lg:grid-cols-[30%_1fr]">
              <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:p-4">
                <div>
                  <h2 className="text-sm font-semibold text-white">System Overview</h2>
                  <p className="mt-0.5 text-xs text-slate-500">Real-time energy flow</p>
                </div>

                <div className="mt-2 min-h-0 flex-1">
                  <EnergyFlowDiagram flow={data.energyFlow} isToday={data.isToday} />
                </div>
              </div>

              <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:p-4">
                <div>
                  <h2 className="text-sm font-semibold text-white">Live Energy</h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Today&apos;s production, consumption, and grid exchange
                  </p>
                </div>

                <div className="mt-2.5 h-[220px] sm:h-[280px] lg:h-[320px] xl:h-[360px]">
                  <Suspense fallback={<ChartSkeleton />}>
                    <DynamicLiveEnergyChart data={data.chartSeries} nowAnnotation={data.nowAnnotation} />
                  </Suspense>
                </div>
              </div>
            </section>

            <section className="grid gap-2.5 lg:grid-cols-2 xl:grid-cols-4">
              <InvertersCard inverters={data.inverters} />
              <WeatherCard />
              <GlidepathCard />
              <MarketEventLog entries={data.eventLog} />
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
