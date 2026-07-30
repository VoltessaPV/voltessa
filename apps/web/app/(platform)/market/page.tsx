import { Suspense } from "react";

import { getStoredExportMode } from "@/lib/automation/automation-state";
import { resolveOrganizationViewAccess } from "@/lib/auth/session";
import { ensureTelemetryFresh } from "@/lib/fusionsolar/telemetry-sync-service";
import {
  computeExportRevenue,
  type RevenueSummary,
} from "@/lib/market-price/revenue";
import { prisma } from "@/lib/prisma";
import { resolvePlantContext } from "@/lib/telemetry/plant-context";

import { ChartSkeleton } from "@/components/charts/ChartSkeleton";
import { MarketDistribution } from "@/components/market/MarketDistribution";
import { MarketEventLog } from "@/components/market/MarketEventLog";
import { MarketInfo } from "@/components/market/MarketInfo";
import { MarketInsights } from "@/components/market/MarketInsights";
import { DynamicMarketPriceChart } from "@/components/market/MarketPriceChart.dynamic";
import { MarketSummaryCard } from "@/components/market/MarketSummaryCard";
import { MarketToolbar } from "@/components/market/MarketToolbar";
import { ConnectFusionSolarButton } from "@/components/platform/ConnectFusionSolarButton";
import { EmptyState } from "@/components/platform/EmptyState";
import { PageContainer } from "@/components/platform/layout/PageContainer";

import { getMarketPageData } from "./market-data";
import { getProductionPageData } from "./production-data";

export { pageHeading } from "./heading";

type Trend = "up" | "down" | "flat";

/**
 * Full date+time, always in Europe/Sofia — never the bare
 * `.toLocaleString()` default, which would render in the server's own
 * timezone (UTC on Vercel) rather than the plant's real local time.
 */
function sofiaDateTimeLabel(date: Date): string {
  return date.toLocaleString("en-GB", { timeZone: "Europe/Sofia" });
}

function priceDeltaTrend(delta: number): { direction: Trend; label: string } {
  const direction: Trend = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "±";

  return { direction, label: `${sign}${Math.abs(delta).toFixed(2)} EUR/MWh` };
}

/**
 * The Configured Mode card's real automation state (AutomationSettings +
 * AutomationState), not FusionSolar's own configuration endpoint - see
 * production-data.ts's `configuredExportMode` doc comment for why that
 * endpoint's own status is deliberately not shown here anymore. Two rows:
 * whether automation is enabled at all, and - only meaningful once it is -
 * which export mode it currently has the plant in. "Enabled" uses the same
 * green accent as the Live badge/Healthy status (`text-emerald-400`,
 * see MarketToolbar's "Live" label) - "Disabled" stays unstyled, falling
 * through to MarketSummaryCard's own default row color.
 */
function configuredModeStatus(
  automationEnabled: boolean,
  currentExportMode: string | null,
): {
  automationLabel: string;
  automationColorClass?: string;
  modeLabel: string;
  modeColorClass: string;
} {
  if (!automationEnabled) {
    return {
      automationLabel: "Disabled",
      modeLabel: "Automation Off",
      modeColorClass: "text-slate-400",
    };
  }

  const isZeroExport = currentExportMode === "Zero Export";

  return {
    automationLabel: "Enabled",
    automationColorClass: "text-emerald-400",
    modeLabel: isZeroExport ? "Zero Export" : "No Limit",
    modeColorClass: isZeroExport ? "text-amber-400" : "text-emerald-400",
  };
}

type MarketPageProps = {
  searchParams: Promise<{ date?: string }>;
};

export default async function MarketPage({ searchParams }: MarketPageProps) {
  // Trader Workspace milestone: resolves either the owner's own
  // organization or an assigned trader's selected organization.
  // `readOnly` suppresses the "Connect Plant" CTA below - it starts a
  // real OAuth flow that would modify the organization, never shown to
  // a read-only Trader. `organizationId` is null only for a Trader with
  // zero assigned clients.
  const { organizationId, readOnly } = await resolveOrganizationViewAccess();
  const params = await searchParams;

  // Trader Workspace milestone: market data is global (`MarketPrice` has no
  // `organizationId` at all - see prisma/schema.prisma), so a Trader with
  // no client selected still gets something real here, unlike
  // Automations/Alerts/BESS's plain empty state. Everything
  // plant-dependent (revenue, current export, configured mode, event log,
  // last-telemetry timestamp) is simply omitted - never fabricated -
  // rather than rendering the full page with those fields permanently
  // "unavailable".
  if (organizationId === null) {
    const data = await getMarketPageData({
      organizationId: null,
      selectedDateParam: params.date,
      automationSettings: null,
    });

    return (
      <PageContainer className="space-y-3">
        <MarketToolbar
          selectedDate={data.selectedDate}
          prevDateParam={data.prevDateParam}
          nextDateParam={data.nextDateParam}
          isToday={data.isToday}
        />

        {!data.dataAvailable ? (
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center">
            <p className="text-sm font-medium text-white">
              No market data available for {data.selectedDate}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Nothing has been imported from ENTSO-E for this day yet. Use the
              date picker above to choose a different day.
            </p>
          </section>
        ) : (
          <>
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:p-4">
              <div>
                <h2 className="text-sm font-semibold text-white">Price &amp; Export</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Platform-wide day-ahead electricity price - select a client to see their
                  export revenue and automation status alongside it.
                </p>
              </div>

              <div className="mt-2.5 h-[200px] sm:h-[280px] lg:h-[320px] xl:h-[380px]">
                <Suspense fallback={<ChartSkeleton />}>
                  <DynamicMarketPriceChart
                    series={data.series}
                    thresholdPrice={data.threshold.minimumExportPrice}
                  />
                </Suspense>
              </div>
            </section>

            <section className="grid gap-2.5 md:grid-cols-2">
              <MarketInsights insights={data.insights} />
              <MarketDistribution buckets={data.distribution} />
            </section>
          </>
        )}
      </PageContainer>
    );
  }

  // Checked before any other data fetching (ENTSO-E price import, revenue,
  // production telemetry) - none of that is plant-specific, so without a
  // plant this page would otherwise still render real market-price widgets
  // with every production-derived field permanently "unavailable". This is
  // a different, earlier gate than the existing `!data.dataAvailable`
  // check below, which stays as the empty state for "has a plant, but
  // ENTSO-E hasn't been imported for this day yet".
  const plantContext = await resolvePlantContext(organizationId);

  if (!plantContext) {
    return (
      <PageContainer className="space-y-3">
        <EmptyState
          title="No plant connected"
          description="Market features - live pricing, export revenue, and automation status - become available after connecting a plant."
        >
          {!readOnly && <ConnectFusionSolarButton />}
        </EmptyState>
      </PageContainer>
    );
  }

  // Transparent Freshness milestone: Market renders telemetry (Current
  // Export, revenue, the price/export chart's settlement overlay), so it
  // blocks on synchronization exactly like Dashboard - see
  // ensureTelemetryFresh's own doc comment. No cache invalidation needed
  // here: this route is fully dynamic (see dashboard/page.tsx's identical
  // comment for why), so getProductionPageData/getMarketPageData below
  // already read live database state regardless.
  await ensureTelemetryFresh(organizationId, { mode: "blocking" });

  const automationSettings = await prisma.automationSettings.findUnique({
    where: { organizationId },
    select: { minimumExportPrice: true, currency: true, automationEnabled: true },
  });

  // Two completely independent data sources, composed only here — see
  // market-data.ts / production-data.ts module doc comments.
  const [data, production, currentExportMode] = await Promise.all([
    getMarketPageData({
      organizationId,
      selectedDateParam: params.date,
      automationSettings,
    }),
    getProductionPageData(organizationId, params.date),
    getStoredExportMode(organizationId),
  ]);

  const configuredMode = configuredModeStatus(
    automationSettings?.automationEnabled ?? false,
    currentExportMode,
  );

  const revenue: RevenueSummary = data.dataAvailable
    ? computeExportRevenue(data.series, production.settlementEnergySeries)
    : { available: false };
  const revenueEyebrow =
    data.dataAvailable && data.isToday ? "Today's Revenue" : "Revenue";

  const currentPriceTrend =
    data.dataAvailable && data.summary.currentPrice
      ? priceDeltaTrend(data.summary.currentPrice.deltaVsPrevious)
      : undefined;

  // Threshold card's status dot: only shown when a live current price
  // exists (today) - a historical day has no "current price" to call
  // healthy or below threshold, so the status area stays empty rather than
  // showing a misleading fixed state.
  const thresholdStatusDot =
    data.dataAvailable && data.summary.currentPrice !== null
      ? data.summary.currentPrice.value >= data.threshold.minimumExportPrice
        ? { colorClass: "bg-emerald-400", label: "Healthy" }
        : { colorClass: "bg-amber-400", label: "Below threshold" }
      : undefined;

  // Grid direction is derived once here so the chart's NOW annotation
  // stays simple — never inferred from configuration, only from the real
  // meter reading. (Market's own top cards no longer show instantaneous
  // grid power — see the Market Dashboard UX Polish milestone — but the
  // chart's live annotation still legitimately wants it.)
  const gridDirection: "export" | "import" | "neutral" | "unavailable" =
    production.currentExport.available && production.currentExport.kw > 0
      ? "export"
      : production.currentImport.available && production.currentImport.kw > 0
        ? "import"
        : production.currentExport.available ||
            production.currentImport.available
          ? "neutral"
          : "unavailable";

  // Current production/grid power is a single real-time reading, never a
  // fabricated time series — only overlay it on the chart when viewing
  // today, since it describes right now, not the day being browsed.
  const nowAnnotationParts: string[] = [];
  if (data.dataAvailable && data.isToday) {
    if (production.currentProduction.available) {
      nowAnnotationParts.push(`${production.currentProduction.kw} kW prod`);
    }
    if (gridDirection === "export" && production.currentExport.available) {
      nowAnnotationParts.push(`${production.currentExport.kw} kW export`);
    } else if (
      gridDirection === "import" &&
      production.currentImport.available
    ) {
      nowAnnotationParts.push(`${production.currentImport.kw} kW import`);
    }
  }
  const nowAnnotation =
    nowAnnotationParts.length > 0 ? nowAnnotationParts.join(" · ") : undefined;

  return (
    <PageContainer className="space-y-3">
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <MarketToolbar
            selectedDate={data.selectedDate}
            prevDateParam={data.prevDateParam}
            nextDateParam={data.nextDateParam}
            isToday={data.isToday}
          />
        </div>
      </div>

      {!data.dataAvailable ? (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center">
          <p className="text-sm font-medium text-white">
            No market data available for {data.selectedDate}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Nothing has been imported from ENTSO-E for this day yet. Use the
            date picker above to choose a different day.
          </p>
        </section>
      ) : (
        <>
          {data.isPartialImport && (
            <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs text-amber-300">
              Today&apos;s import is partial — some intervals are missing from
              ENTSO-E and are shown as gaps, never fabricated.
            </p>
          )}

          <section className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
            <MarketSummaryCard
              eyebrow={revenueEyebrow}
              value={
                revenue.available ? revenue.revenueEur.toFixed(2) : undefined
              }
              valueUnit={revenue.available ? "EUR" : undefined}
              unavailableNote="Waiting for production telemetry"
              rows={
                revenue.available
                  ? [
                      {
                        label: "Exported today",
                        value: `${revenue.exportedKwh.toFixed(2)} kWh`,
                      },
                      {
                        label: "Average selling price",
                        value:
                          revenue.averagePriceEurPerMwh !== null
                            ? `${revenue.averagePriceEurPerMwh.toFixed(2)} EUR/MWh`
                            : "—",
                      },
                    ]
                  : undefined
              }
            />

            <MarketSummaryCard
              eyebrow="Current Price"
              value={data.summary.currentPrice?.value.toString()}
              valueUnit={data.summary.currentPrice ? "EUR/MWh" : undefined}
              caption={data.summary.currentPrice?.intervalLabel}
              unavailableNote="Live price only available for today"
              trend={currentPriceTrend}
            />

            <MarketSummaryCard
              eyebrow="Current Export"
              value={
                production.currentExport.available
                  ? production.currentExport.kw.toString()
                  : undefined
              }
              valueUnit={production.currentExport.available ? "kW" : undefined}
              unavailableNote="FusionSolar meter data unavailable"
            />

            <MarketSummaryCard
              eyebrow="Configured Mode"
              rows={[
                {
                  label: "Automation",
                  value: configuredMode.automationLabel,
                  valueColorClass: configuredMode.automationColorClass,
                },
                {
                  label: "Current Mode",
                  value: configuredMode.modeLabel,
                  valueColorClass: configuredMode.modeColorClass,
                },
              ]}
            />

            <MarketSummaryCard
              eyebrow="Threshold"
              value={data.threshold.minimumExportPrice.toString()}
              valueUnit={`${data.threshold.currency}/MWh`}
              caption="Minimum profitable price"
              statusDot={thresholdStatusDot}
            />
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:p-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Price &amp; Export
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Electricity price and recommended export windows
                </p>
              </div>
            </div>

            <div className="mt-2.5 h-[200px] sm:h-[280px] lg:h-[320px] xl:h-[380px]">
              <Suspense fallback={<ChartSkeleton />}>
                <DynamicMarketPriceChart
                  series={data.series}
                  thresholdPrice={data.threshold.minimumExportPrice}
                  nowAnnotation={nowAnnotation}
                  // production-data.ts computes this for whichever day is
                  // selected (the whole day if it's a past day, today-so-far
                  // if it's today) — historical days now render telemetry
                  // exactly like today, fixing the earlier "historical
                  // telemetry missing" bug (this used to be unconditionally
                  // suppressed for any non-today day).
                  //
                  // Narrowed to the two fields MarketPriceChart actually
                  // reads — `importedKwh` is real data used elsewhere (KPI
                  // totals), just never by this chart, so it's dropped here
                  // rather than serialized into this prop for nothing.
                  settlementEnergySeries={production.settlementEnergySeries.map(
                    ({ intervalStart, exportedKwh }) => ({ intervalStart, exportedKwh }),
                  )}
                  installedCapacityKw={production.installedCapacityKw}
                />
              </Suspense>
            </div>
          </section>

          <section className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
            <MarketEventLog entries={data.eventLog} />
            <MarketInsights insights={data.insights} />
            <MarketDistribution buckets={data.distribution} />
            <MarketInfo
              country={data.summary.marketStatus.country}
              source={data.summary.marketStatus.source}
              // The newest real DeviceTelemetry sample for this plant —
              // not the ENTSO-E price-import timestamp (which is largely
              // static and was found to be hours staler than the
              // telemetry actually driving this page's chart/revenue
              // figures; see production-data.ts's `latestTelemetryAt`
              // doc comment for the traced root cause).
              lastUpdateLabel={
                production.latestTelemetryAt
                  ? sofiaDateTimeLabel(production.latestTelemetryAt)
                  : null
              }
            />
          </section>
        </>
      )}
    </PageContainer>
  );
}
