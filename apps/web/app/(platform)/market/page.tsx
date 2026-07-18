import { MarketDistribution } from "@/components/market/MarketDistribution";
import { MarketInsights } from "@/components/market/MarketInsights";
import { MarketPriceChart } from "@/components/market/MarketPriceChart";
import { MarketRevenueCard } from "@/components/market/MarketRevenueCard";
import { MarketSummaryCard } from "@/components/market/MarketSummaryCard";
import { MarketTimeline } from "@/components/market/MarketTimeline";

import { getMockMarketPageData } from "./mock-data";

const TREND_LABEL_PREFIX: Record<"up" | "down" | "flat", string> = {
  up: "+",
  down: "",
  flat: "±",
};

export default function MarketPage() {
  const { series, summary, revenue, timeline, distribution, insights } =
    getMockMarketPageData();

  const deltaDirection =
    summary.currentPrice.deltaVsPrevious > 0
      ? "up"
      : summary.currentPrice.deltaVsPrevious < 0
        ? "down"
        : "flat";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section>
        <p className="text-sm font-medium text-cyan-400">
          Bulgarian day-ahead market
        </p>

        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              Market
            </h1>

            <p className="mt-2 text-sm text-slate-400">
              Electricity prices, export windows and revenue for today.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MarketSummaryCard
          eyebrow="Current Price"
          value={summary.currentPrice.value.toString()}
          valueUnit="EUR/MWh"
          caption={summary.currentPrice.intervalLabel}
          trend={{
            direction: deltaDirection,
            label: `${TREND_LABEL_PREFIX[deltaDirection]}${Math.abs(summary.currentPrice.deltaVsPrevious)}`,
          }}
        />

        <MarketSummaryCard
          eyebrow="Next Hour"
          value={summary.nextHour.value.toString()}
          valueUnit="EUR/MWh"
          caption={summary.nextHour.intervalLabel}
          trend={{
            direction: summary.nextHour.direction,
            label:
              summary.nextHour.direction === "up"
                ? "Rising"
                : summary.nextHour.direction === "down"
                  ? "Falling"
                  : "Flat",
          }}
        />

        <MarketSummaryCard
          eyebrow="Lowest Today"
          value={summary.lowestToday.value.toString()}
          valueUnit="EUR/MWh"
          caption={summary.lowestToday.intervalLabel}
        />

        <MarketSummaryCard
          eyebrow="Highest Today"
          value={summary.highestToday.value.toString()}
          valueUnit="EUR/MWh"
          caption={summary.highestToday.intervalLabel}
        />

        <MarketSummaryCard
          eyebrow="Market Status"
          statusDot={{
            colorClass: summary.marketStatus.healthy
              ? "bg-emerald-400"
              : "bg-red-400",
            label: summary.marketStatus.healthy ? "Healthy" : "Degraded",
          }}
          rows={[
            { label: "Country", value: summary.marketStatus.country },
            { label: "Source", value: summary.marketStatus.source },
            {
              label: "Last update",
              value: summary.marketStatus.lastUpdateLabel,
            },
          ]}
        />
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">
              Price &amp; Export
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Day-ahead price, export power and export windows
            </p>
          </div>
        </div>

        <div className="mt-4 h-[280px] sm:h-[420px] lg:h-[460px] xl:h-[560px]">
          <MarketPriceChart series={series} />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <MarketRevenueCard revenue={revenue} />
        <MarketTimeline events={timeline} />
        <MarketDistribution buckets={distribution} />
        <MarketInsights insights={insights} />
      </section>
    </div>
  );
}
