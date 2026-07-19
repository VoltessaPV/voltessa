import { requireOnboardedUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

import { MarketDistribution } from "@/components/market/MarketDistribution";
import { MarketEventLog } from "@/components/market/MarketEventLog";
import { MarketInsights } from "@/components/market/MarketInsights";
import { MarketPriceChart } from "@/components/market/MarketPriceChart";
import { MarketRevenueCard } from "@/components/market/MarketRevenueCard";
import { MarketSummaryCard } from "@/components/market/MarketSummaryCard";
import { MarketToolbar } from "@/components/market/MarketToolbar";

import { getMarketPageData } from "./market-data";
import { getProductionPageData } from "./production-data";

const TREND_LABEL_PREFIX: Record<"up" | "down" | "flat", string> = {
  up: "+",
  down: "",
  flat: "±",
};

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
    getProductionPageData(user.organizationId),
  ]);

  const currentPriceDelta = data.dataAvailable
    ? data.summary.currentPrice?.deltaVsPrevious
    : undefined;
  const currentPriceDirection: "up" | "down" | "flat" =
    currentPriceDelta === undefined
      ? "flat"
      : currentPriceDelta > 0
        ? "up"
        : currentPriceDelta < 0
          ? "down"
          : "flat";

  // Grid direction is derived once here so the card below stays simple —
  // never inferred from configuration, only from the real meter reading.
  const gridDirection: "export" | "import" | "neutral" | "unavailable" =
    production.currentExport.available && production.currentExport.kw > 0
      ? "export"
      : production.currentImport.available && production.currentImport.kw > 0
        ? "import"
        : production.currentExport.available || production.currentImport.available
          ? "neutral"
          : "unavailable";

  const gridValue =
    gridDirection === "export" && production.currentExport.available
      ? production.currentExport.kw.toString()
      : gridDirection === "import" && production.currentImport.available
        ? production.currentImport.kw.toString()
        : gridDirection === "neutral"
          ? "0"
          : undefined;

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
    } else if (gridDirection === "import" && production.currentImport.available) {
      nowAnnotationParts.push(`${production.currentImport.kw} kW import`);
    }
  }
  const nowAnnotation =
    nowAnnotationParts.length > 0 ? nowAnnotationParts.join(" · ") : undefined;

  return (
    <div className="mx-auto max-w-7xl space-y-3">
      <section className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-cyan-400">
            Bulgarian day-ahead market
          </p>
          <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-white">
            Market
          </h1>
        </div>
      </section>

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
              Today&apos;s import is partial — some intervals are missing
              from ENTSO-E and are shown as gaps, never fabricated.
            </p>
          )}

          <section className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
            <MarketSummaryCard
              eyebrow="Current Price"
              value={data.summary.currentPrice?.value.toString()}
              valueUnit={data.summary.currentPrice ? "EUR/MWh" : undefined}
              caption={data.summary.currentPrice?.intervalLabel}
              unavailableNote="Live price only available for today"
              trend={
                data.summary.currentPrice
                  ? {
                      direction: currentPriceDirection,
                      label: `${TREND_LABEL_PREFIX[currentPriceDirection]}${Math.abs(data.summary.currentPrice.deltaVsPrevious)}`,
                    }
                  : undefined
              }
            />

            <MarketSummaryCard
              eyebrow="Current Production"
              value={
                production.currentProduction.available
                  ? production.currentProduction.kw.toString()
                  : undefined
              }
              valueUnit={production.currentProduction.available ? "kW" : undefined}
              caption={
                production.todaysProduction.available
                  ? `Today: ${production.todaysProduction.kwh} kWh`
                  : undefined
              }
              unavailableNote="FusionSolar production data unavailable"
            />

            <MarketSummaryCard
              eyebrow={gridDirection === "import" ? "Current Import" : "Current Export"}
              value={gridValue}
              valueUnit={gridValue !== undefined ? "kW" : undefined}
              caption={
                gridDirection === "export"
                  ? "Exporting to grid"
                  : gridDirection === "import"
                    ? "Importing from grid"
                    : gridDirection === "neutral"
                      ? "No grid exchange"
                      : undefined
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
              caption="Minimum profitable export price"
              statusDot={{
                colorClass: data.summary.marketStatus.healthy
                  ? "bg-emerald-400"
                  : "bg-red-400",
                label: data.summary.marketStatus.healthy ? "Healthy" : "Degraded",
              }}
              rows={[
                { label: "Country", value: data.summary.marketStatus.country },
                { label: "Source", value: data.summary.marketStatus.source },
                ...(data.summary.marketStatus.lastUpdateLabel
                  ? [
                      {
                        label: "Last update",
                        value: data.summary.marketStatus.lastUpdateLabel,
                      },
                    ]
                  : []),
              ]}
            />
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:p-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Price &amp; Export
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Day-ahead price and export windows
                </p>
              </div>
            </div>

            <div className="mt-2.5 h-[200px] sm:h-[280px] lg:h-[320px] xl:h-[380px]">
              <MarketPriceChart
                series={data.series}
                thresholdPrice={data.threshold.minimumExportPrice}
                nowAnnotation={nowAnnotation}
                // Real telemetry only exists for "today so far" — never
                // shown when browsing a past/future day via the toolbar,
                // rather than fabricating or reusing today's data for a
                // different date.
                telemetrySeries={data.isToday ? production.telemetrySeries : undefined}
              />
            </div>
          </section>

          <section className="grid gap-2.5 lg:grid-cols-2 xl:grid-cols-4">
            <MarketRevenueCard />
            <MarketEventLog entries={data.eventLog} />
            <MarketDistribution buckets={data.distribution} />
            <MarketInsights
              insights={[...data.insights, ...production.telemetryInsights]}
            />
          </section>
        </>
      )}
    </div>
  );
}
