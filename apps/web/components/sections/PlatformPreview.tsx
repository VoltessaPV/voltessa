import { Suspense } from "react";

import { ChartSkeleton } from "@/components/charts/ChartSkeleton";
import { EnergyFlowDiagram } from "@/components/dashboard/EnergyFlowDiagram";
import { GlidepathCard } from "@/components/dashboard/GlidepathCard";
import { InvertersCard } from "@/components/dashboard/InvertersCard";
import { DynamicLiveEnergyChart } from "@/components/dashboard/LiveEnergyChart.dynamic";
import { WeatherCard } from "@/components/dashboard/WeatherCard";
import { MarketDistribution } from "@/components/market/MarketDistribution";
import { MarketEventLog } from "@/components/market/MarketEventLog";
import { MarketInfo } from "@/components/market/MarketInfo";
import { MarketInsights } from "@/components/market/MarketInsights";
import { DynamicMarketPriceChart } from "@/components/market/MarketPriceChart.dynamic";
import { MarketSummaryCard } from "@/components/market/MarketSummaryCard";
import {
  DEMO_DASHBOARD_DATA,
  DEMO_MARKET_DATA,
  DEMO_PRODUCTION_DATA,
} from "@/lib/demo/demo-organization";

/**
 * Landing Page Platform Preview milestone. Renders the exact same
 * presentational components the authenticated Dashboard/Market pages use
 * (`app/(platform)/dashboard/page.tsx` / `app/(platform)/market/page.tsx`),
 * fed static demo data (`lib/demo/demo-organization.ts`) instead of a
 * database read. No `AppShell`/sidebar/header, no auth check, no server
 * action, no Huawei call, no "use server" import anywhere in this file —
 * every component below is presentational-only (confirmed: none of them
 * import `lib/auth/*`, `lib/fusionsolar/*`, or a `"use server"` action
 * file). Read `data`/`production` from the same imported demo objects
 * dashboard/market pages would read from `getDashboardPageData`/
 * `getMarketPageData`/`getProductionPageData` — this file is only about
 * layout/composition, never a new visual design.
 *
 * The four sections (Dashboard, Market, BESS, Automations) are rendered as
 * one continuous scroll — same spacing rhythm each real page already uses
 * internally (`space-y-3`) — not as separate, isolated marketing showcases.
 */

const data = DEMO_DASHBOARD_DATA;
const market = DEMO_MARKET_DATA;
const production = DEMO_PRODUCTION_DATA;

function energyValueLabel(kwh: number | null): string | undefined {
  return kwh !== null ? kwh.toFixed(1) : undefined;
}

function mwhValueLabel(kwh: number | null): string | undefined {
  return kwh !== null ? (kwh / 1000).toFixed(1) : undefined;
}

/** Same eyebrow/title typography `PageHeading` renders in the real app header — reused here as plain JSX since `PageHeading` itself depends on a real route's `usePathname()`, which doesn't apply to this single static scroll. */
function PreviewSectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-cyan-400">{eyebrow}</p>
      <h2 className="mt-0.5 text-xl font-semibold tracking-tight text-white">{title}</h2>
    </div>
  );
}

const currentPriceTrend = { direction: "up" as const, label: "+4.20 EUR/MWh" };

const nowAnnotation =
  data.energyFlow.available && production.currentExport.available
    ? `${data.energyFlow.pvKw} kW prod · ${production.currentExport.kw} kW export`
    : undefined;

export function PlatformPreview() {
  return (
    <div className="w-full rounded-2xl border border-white/10 bg-[#050816] p-6 text-white">
      {/* ---------------- Dashboard ---------------- */}
      <PreviewSectionHeading eyebrow="Live Operations" title="Dashboard" />

      <div className="mt-3 space-y-3">
        <section className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          <MarketSummaryCard
            eyebrow="Yield Today"
            value={energyValueLabel(data.kpis.producedTodayKwh)}
            valueUnit="kWh"
          />
          <MarketSummaryCard
            eyebrow="Total Yield"
            value={mwhValueLabel(data.kpis.totalYieldKwh)}
            valueUnit="MWh"
          />
          <MarketSummaryCard
            eyebrow="Consumption Today"
            value={energyValueLabel(data.kpis.consumedTodayKwh)}
            valueUnit="kWh"
          />
          <MarketSummaryCard
            eyebrow="Consumed from PV"
            value={energyValueLabel(data.kpis.consumedFromPvKwh)}
            valueUnit="kWh"
          />
          <MarketSummaryCard
            eyebrow="Fed to Grid"
            value={energyValueLabel(data.kpis.exportedTodayKwh)}
            valueUnit="kWh"
          />
          <MarketSummaryCard
            eyebrow="From Grid"
            value={energyValueLabel(data.kpis.importedTodayKwh)}
            valueUnit="kWh"
          />
        </section>

        <section className="grid gap-2.5 lg:grid-cols-[30%_1fr]">
          <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:p-4">
            <div>
              <h3 className="text-sm font-semibold text-white">System Overview</h3>
              <p className="mt-0.5 text-xs text-slate-500">Real-time energy flow</p>
            </div>
            <div className="mt-2 min-h-0 flex-1">
              <EnergyFlowDiagram flow={data.energyFlow} isToday={data.isToday} />
            </div>
          </div>

          <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:p-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Live Energy</h3>
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

      {/* ---------------- Market ---------------- */}
      <div className="mt-8">
        <PreviewSectionHeading eyebrow="Electricity Market" title="Market" />

        <div className="mt-3 space-y-3">
          <section className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
            <MarketSummaryCard
              eyebrow="Today's Revenue"
              value={market.summary.currentPrice && data.kpis.revenue.available ? data.kpis.revenue.revenueEur.toFixed(2) : undefined}
              valueUnit="EUR"
              rows={
                data.kpis.revenue.available
                  ? [
                      { label: "Exported today", value: `${data.kpis.revenue.exportedKwh.toFixed(2)} kWh` },
                      {
                        label: "Average selling price",
                        value:
                          data.kpis.revenue.averagePriceEurPerMwh !== null
                            ? `${data.kpis.revenue.averagePriceEurPerMwh.toFixed(2)} EUR/MWh`
                            : "—",
                      },
                    ]
                  : undefined
              }
            />

            <MarketSummaryCard
              eyebrow="Current Price"
              value={market.summary.currentPrice?.value.toString()}
              valueUnit="EUR/MWh"
              caption={market.summary.currentPrice?.intervalLabel}
              trend={currentPriceTrend}
            />

            <MarketSummaryCard
              eyebrow="Current Export"
              value={production.currentExport.available ? production.currentExport.kw.toString() : undefined}
              valueUnit="kW"
            />

            <MarketSummaryCard
              eyebrow="Configured Mode"
              statusDot={{
                colorClass: production.configuredExportModeLabel.colorClass,
                label: production.configuredExportModeLabel.label,
              }}
              rows={[{ label: "Source", value: "Huawei configuration endpoint" }]}
            />

            <MarketSummaryCard
              eyebrow="Threshold"
              value={market.threshold.minimumExportPrice.toString()}
              valueUnit={`${market.threshold.currency}/MWh`}
              caption="Minimum profitable price"
              statusDot={{
                colorClass: market.summary.marketStatus.healthy ? "bg-emerald-400" : "bg-red-400",
                label: market.summary.marketStatus.healthy ? "Healthy" : "Degraded",
              }}
            />
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:p-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Price &amp; Export</h3>
              <p className="mt-0.5 text-xs text-slate-500">Electricity price and recommended export windows</p>
            </div>

            <div className="mt-2.5 h-[200px] sm:h-[280px] lg:h-[320px] xl:h-[380px]">
              <Suspense fallback={<ChartSkeleton />}>
                <DynamicMarketPriceChart
                  series={market.series}
                  thresholdPrice={market.threshold.minimumExportPrice}
                  nowAnnotation={nowAnnotation}
                  settlementEnergySeries={production.settlementEnergySeries.map(
                    ({ intervalStart, exportedKwh }) => ({ intervalStart, exportedKwh }),
                  )}
                  installedCapacityKw={production.installedCapacityKw}
                />
              </Suspense>
            </div>
          </section>

          <section className="grid gap-2.5 lg:grid-cols-2 xl:grid-cols-4">
            <MarketEventLog entries={market.eventLog} />
            <MarketInsights insights={market.insights} />
            <MarketDistribution buckets={market.distribution} />
            <MarketInfo
              country={market.summary.marketStatus.country}
              source={market.summary.marketStatus.source}
              lastUpdateLabel="16:26"
            />
          </section>
        </div>
      </div>

      {/* ---------------- BESS ---------------- */}
      <div className="mt-8">
        <PreviewSectionHeading eyebrow="Battery Energy Storage" title="BESS" />

        <div className="mt-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)]">
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Status</p>
            <p className="mt-3 text-sm text-slate-400">No battery systems connected.</p>
            <p className="mt-1 max-w-md text-xs text-slate-600">
              Voltessa automatically detects and manages battery assets when available.
            </p>
          </div>
        </div>
      </div>

      {/* ---------------- Automations ---------------- */}
      <div className="mt-8">
        <PreviewSectionHeading eyebrow="Plant Control" title="Automations" />

        <div className="mt-3">
          <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h3 className="text-lg font-medium">Huawei Control</h3>
            <p className="mt-2 text-sm text-white/60">
              Manual export-control commands for this plant&apos;s Huawei FusionSolar connection.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                disabled
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white opacity-50"
              >
                Enable No Limit
              </button>

              <button
                type="button"
                disabled
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white opacity-50"
              >
                Enable Zero Export
              </button>
            </div>

            <p className="mt-4 text-xs text-slate-500">
              Available for this plant, disabled in this preview — real commands require a
              connected account.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
