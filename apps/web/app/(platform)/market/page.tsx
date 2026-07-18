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

  const data = await getMarketPageData({
    selectedDateParam: params.date,
    automationSettings,
  });

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
              eyebrow="Next Interval"
              value={data.summary.nextInterval?.value.toString()}
              valueUnit={data.summary.nextInterval ? "EUR/MWh" : undefined}
              caption={data.summary.nextInterval?.intervalLabel}
              unavailableNote="Live price only available for today"
              trend={
                data.summary.nextInterval
                  ? {
                      direction: data.summary.nextInterval.direction,
                      label:
                        data.summary.nextInterval.direction === "up"
                          ? "Rising"
                          : data.summary.nextInterval.direction === "down"
                            ? "Falling"
                            : "Flat",
                    }
                  : undefined
              }
            />

            <MarketSummaryCard
              eyebrow="Lowest"
              value={data.summary.lowestToday.value.toString()}
              valueUnit="EUR/MWh"
              caption={data.summary.lowestToday.intervalLabel}
            />

            <MarketSummaryCard
              eyebrow="Highest"
              value={data.summary.highestToday.value.toString()}
              valueUnit="EUR/MWh"
              caption={data.summary.highestToday.intervalLabel}
            />

            <MarketSummaryCard
              eyebrow="Market Status"
              statusDot={{
                colorClass: data.summary.marketStatus.healthy
                  ? "bg-emerald-400"
                  : "bg-red-400",
                label: data.summary.marketStatus.healthy
                  ? "Healthy"
                  : "Degraded",
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
                {
                  label: "Min. profitable price",
                  value: `${data.threshold.minimumExportPrice} ${data.threshold.currency}/MWh`,
                  valueColorClass: "text-amber-400",
                },
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
              />
            </div>
          </section>

          <section className="grid gap-2.5 lg:grid-cols-2 xl:grid-cols-4">
            <MarketRevenueCard />
            <MarketEventLog entries={data.eventLog} />
            <MarketDistribution buckets={data.distribution} />
            <MarketInsights insights={data.insights} />
          </section>
        </>
      )}
    </div>
  );
}
