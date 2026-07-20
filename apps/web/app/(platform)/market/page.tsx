import { requireOnboardedUser } from "@/lib/auth/session";
import {
  computeExportRevenue,
  type RevenueSummary,
} from "@/lib/market-price/revenue";
import { prisma } from "@/lib/prisma";

import { MarketDistribution } from "@/components/market/MarketDistribution";
import { MarketEventLog } from "@/components/market/MarketEventLog";
import { MarketInfo } from "@/components/market/MarketInfo";
import { MarketInsights } from "@/components/market/MarketInsights";
import { MarketPriceChart } from "@/components/market/MarketPriceChart";
import { MarketSummaryCard } from "@/components/market/MarketSummaryCard";
import { MarketToolbar } from "@/components/market/MarketToolbar";
import { AppShell } from "@/components/platform/layout/AppShell";

import { getMarketPageData } from "./market-data";
import { getProductionPageData } from "./production-data";

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

type MarketPageProps = {
  searchParams: Promise<{ date?: string }>;
};

export default async function MarketPage({ searchParams }: MarketPageProps) {
  const user = await requireOnboardedUser();
  const params = await searchParams;

  const automationSettings = await prisma.automationSettings.findUnique({
    where: { organizationId: user.organizationId },
  });

  // Two completely independent data sources, composed only here — see
  // market-data.ts / production-data.ts module doc comments.
  const [data, production] = await Promise.all([
    getMarketPageData({
      selectedDateParam: params.date,
      automationSettings,
    }),
    getProductionPageData(user.organizationId, params.date),
  ]);

  const revenue: RevenueSummary = data.dataAvailable
    ? computeExportRevenue(data.series, production.settlementEnergySeries)
    : { available: false };
  const revenueEyebrow =
    data.dataAvailable && data.isToday ? "Today's Revenue" : "Revenue";

  const currentPriceTrend =
    data.dataAvailable && data.summary.currentPrice
      ? priceDeltaTrend(data.summary.currentPrice.deltaVsPrevious)
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
    <AppShell
      user={{ name: user.name, email: user.email, role: user.role }}
      eyebrow="Bulgarian day-ahead market"
      title="Market"
    >
      <div className="mr-auto max-w-7xl space-y-3">
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
                valueUnit={
                  production.currentExport.available ? "kW" : undefined
                }
                unavailableNote="FusionSolar meter data unavailable"
              />

              <MarketSummaryCard
                eyebrow="Configured Mode"
                statusDot={{
                  colorClass: production.configuredExportModeLabel.colorClass,
                  label: production.configuredExportModeLabel.label,
                }}
                rows={[
                  { label: "Source", value: "Huawei configuration endpoint" },
                ]}
              />

              <MarketSummaryCard
                eyebrow="Threshold"
                value={data.threshold.minimumExportPrice.toString()}
                valueUnit={`${data.threshold.currency}/MWh`}
                caption="Minimum profitable price"
                statusDot={{
                  colorClass: data.summary.marketStatus.healthy
                    ? "bg-emerald-400"
                    : "bg-red-400",
                  label: data.summary.marketStatus.healthy
                    ? "Healthy"
                    : "Degraded",
                }}
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
                <MarketPriceChart
                  series={data.series}
                  thresholdPrice={data.threshold.minimumExportPrice}
                  nowAnnotation={nowAnnotation}
                  // production-data.ts computes this for whichever day is
                  // selected (the whole day if it's a past day, today-so-far
                  // if it's today) — historical days now render telemetry
                  // exactly like today, fixing the earlier "historical
                  // telemetry missing" bug (this used to be unconditionally
                  // suppressed for any non-today day).
                  settlementEnergySeries={production.settlementEnergySeries}
                  installedCapacityKw={production.installedCapacityKw}
                />
              </div>
            </section>

            <section className="grid gap-2.5 lg:grid-cols-2 xl:grid-cols-4">
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
      </div>
    </AppShell>
  );
}
