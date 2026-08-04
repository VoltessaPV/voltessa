import { Suspense } from "react";
import { getTranslations } from "next-intl/server";

import { getStoredExportMode } from "@/lib/automation/automation-state";
import { resolveOrganizationViewAccess } from "@/lib/auth/session";
import { ensureTelemetryFresh } from "@/lib/fusionsolar/telemetry-sync-service";
import {
  computeExportRevenue,
  type RevenueSummary,
} from "@/lib/market-price/revenue";
import { formatDateInZone, type CalendarPeriod } from "@/lib/market-price/timezone";
import { prisma } from "@/lib/prisma";
import { resolvePlantContext } from "@/lib/telemetry/plant-context";
import { revalidateTelemetryPagesIfSynced } from "@/lib/telemetry/revalidate-telemetry-pages";
import type { SettlementEnergyPoint } from "@/lib/telemetry/energy-metrics";

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

import { getMarketPageData, type MarketPricePoint } from "./market-data";
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

function parsePeriod(value: string | undefined): CalendarPeriod {
  return value === "week" || value === "month" || value === "year" ? value : "today";
}

/**
 * Dashboard & Market Analytics milestone (Weekly/Monthly/Yearly). ▲/▼ +
 * absolute + percentage difference versus the previous calendar period —
 * reuses `MarketSummaryCard`'s existing `trend` prop (already built for
 * Current Price's day-over-day delta above), just fed a period-over-period
 * comparison instead. `null` whenever either value is unavailable — never
 * fabricated.
 */
function periodComparisonTrend(
  current: number | null,
  previous: number | null,
  unit: string,
  suffix: string,
): { direction: Trend; label: string } | undefined {
  if (current === null || previous === null) {
    return undefined;
  }

  const absoluteDelta = Math.round((current - previous) * 100) / 100;
  const direction: Trend = absoluteDelta > 0 ? "up" : absoluteDelta < 0 ? "down" : "flat";
  const sign = absoluteDelta > 0 ? "+" : absoluteDelta < 0 ? "-" : "±";
  const percentDelta = previous !== 0 ? (absoluteDelta / Math.abs(previous)) * 100 : null;
  const percentPart = percentDelta !== null ? ` (${sign}${Math.abs(percentDelta).toFixed(1)}%)` : "";

  return {
    direction,
    label: `${sign}${Math.abs(absoluteDelta).toFixed(2)} ${unit}${percentPart} ${suffix}`,
  };
}

/**
 * Dashboard & Market Analytics milestone (Weekly/Monthly/Yearly). Buckets
 * `production.settlementEnergySeries` (native 15-minute resolution across
 * the whole selected period) into one point per calendar day (Week/Month)
 * or per calendar month (Year), for `MarketPriceChart`'s exported-energy
 * bars — same technique `market-data.ts`'s `buildPeriodPriceChartSeries`
 * uses for the price line, kept here (not there) since it operates on
 * `production-data.ts`'s output, not `market-data.ts`'s.
 */
function bucketSettlementForChart(
  period: "week" | "month" | "year",
  points: SettlementEnergyPoint[],
): Pick<SettlementEnergyPoint, "intervalStart" | "exportedKwh">[] {
  const granularity: "day" | "month" = period === "year" ? "month" : "day";
  const bucketKey = (instant: Date) => {
    const dateStr = formatDateInZone(instant, "Europe/Sofia");
    return granularity === "day" ? dateStr : dateStr.slice(0, 7);
  };

  const sumByBucket = new Map<string, number>();
  const instantByBucket = new Map<string, number>();

  for (const point of points) {
    if (point.exportedKwh === null) {
      continue;
    }

    const key = bucketKey(point.intervalStart);
    sumByBucket.set(key, (sumByBucket.get(key) ?? 0) + point.exportedKwh);
    if (!instantByBucket.has(key)) {
      instantByBucket.set(key, point.intervalStart.getTime());
    }
  }

  const keys = [...instantByBucket.keys()].sort(
    (a, b) => (instantByBucket.get(a) as number) - (instantByBucket.get(b) as number),
  );

  return keys.map((key) => ({
    intervalStart: new Date(instantByBucket.get(key) as number),
    exportedKwh: Math.round((sumByBucket.get(key) as number) * 100) / 100,
  }));
}

/**
 * Historical Analytics Refinement milestone. The Price & Export chart's
 * blue line for Week/Month/Year: the plant's real Average Selling Price
 * per bucket — `Σ(exportedKwh × price) / Σ(exportedKwh)`, calculated once
 * from bucket TOTALS, never as an average of already-averaged daily/
 * interval prices (the mathematically correct weighted average). This is
 * a genuinely different business metric from the raw ENTSO-E price
 * `market-data.ts`'s own `series` carries — it only equals the price when
 * the plant happened to export perfectly evenly across every price level,
 * which real export patterns never do.
 *
 * Computed here, not in `market-data.ts`, because it combines real price
 * (`market-data.ts`) with real exported energy (`production-data.ts`) —
 * the same two independent modules `computeExportRevenue` below already
 * combines for the period TOTAL (the Revenue card's own "Average selling
 * price" row); this is that identical math, per calendar bucket instead
 * of once over the whole period. Both already-fetched native-resolution
 * arrays are reused as-is — no second query.
 *
 * `null` (never `0`) whenever a bucket exported nothing, so the chart
 * renders a real gap (`Line`'s `connectNulls={false}`) instead of a
 * fabricated zero price — dividing by zero exported energy is never
 * attempted.
 */
function buildAspChartSeries(
  period: "week" | "month" | "year",
  priceSeries: MarketPricePoint[],
  settlementSeries: SettlementEnergyPoint[],
): MarketPricePoint[] {
  const granularity: "day" | "month" = period === "year" ? "month" : "day";
  const bucketKey = (instant: Date) => {
    const dateStr = formatDateInZone(instant, "Europe/Sofia");
    return granularity === "day" ? dateStr : dateStr.slice(0, 7);
  };

  const priceByTime = new Map(
    priceSeries
      .filter((point): point is MarketPricePoint & { price: number } => point.price !== null)
      .map((point) => [point.timestamp.getTime(), point.price]),
  );

  const revenueByBucket = new Map<string, number>();
  const exportedByBucket = new Map<string, number>();
  const instantByBucket = new Map<string, number>();

  for (const point of settlementSeries) {
    if (point.exportedKwh === null) {
      continue;
    }

    const price = priceByTime.get(point.intervalStart.getTime());
    if (price === undefined) {
      // No matching real price for this real settlement interval - this
      // interval simply doesn't contribute to either total, exactly like
      // `computeExportRevenue`'s own handling of the same case.
      continue;
    }

    const key = bucketKey(point.intervalStart);
    revenueByBucket.set(key, (revenueByBucket.get(key) ?? 0) + (point.exportedKwh * price) / 1000);
    exportedByBucket.set(key, (exportedByBucket.get(key) ?? 0) + point.exportedKwh);
    if (!instantByBucket.has(key)) {
      instantByBucket.set(key, point.intervalStart.getTime());
    }
  }

  const keys = [...instantByBucket.keys()].sort(
    (a, b) => (instantByBucket.get(a) as number) - (instantByBucket.get(b) as number),
  );

  return keys.map((key) => {
    const exportedKwh = exportedByBucket.get(key) ?? 0;
    const revenueEur = revenueByBucket.get(key) ?? 0;
    const averageSellingPrice =
      exportedKwh > 0 ? Math.round((revenueEur / (exportedKwh / 1000)) * 100) / 100 : null;

    return {
      timestamp: new Date(instantByBucket.get(key) as number),
      price: averageSellingPrice,
      // Export-threshold recommendation has no meaning for a historical
      // Average Selling Price point - the chart never renders the
      // threshold line/legend for these periods either (see `page.tsx`'s
      // `showThreshold` prop).
      exportEnabled: false,
    };
  });
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
  t: Awaited<ReturnType<typeof getTranslations<"market.summary">>>,
  tTerm: Awaited<ReturnType<typeof getTranslations<"terminology">>>,
): {
  automationLabel: string;
  automationColorClass?: string;
  modeLabel: string;
  modeColorClass: string;
} {
  if (!automationEnabled) {
    return {
      automationLabel: t("disabled"),
      modeLabel: t("automationOff"),
      modeColorClass: "text-slate-400",
    };
  }

  const isZeroExport = currentExportMode === "Zero Export";

  return {
    automationLabel: t("enabled"),
    automationColorClass: "text-emerald-400",
    modeLabel: isZeroExport ? tTerm("zeroExport") : tTerm("noLimit"),
    modeColorClass: isZeroExport ? "text-amber-400" : "text-emerald-400",
  };
}

type MarketPageProps = {
  searchParams: Promise<{ date?: string; period?: string }>;
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
  const period = parsePeriod(params.period);

  // Database-First Architecture milestone: Market is now a pure read over
  // MarketPrice/DeviceTelemetry — it never calls Huawei or ENTSO-E, never
  // triggers or waits on an import, and never checks remote availability.
  // A period with nothing in the database renders the existing "no market
  // data" empty state below instead of this page attempting to fill the
  // gap itself. Historical backfill is a separate, explicit concern now —
  // see `lib/historical-data/ensure-day-available.ts`'s module doc comment.

  // Trader Workspace milestone: market data is global (`MarketPrice` has no
  // `organizationId` at all - see prisma/schema.prisma), so a Trader with
  // no client selected still gets something real here, unlike
  // Automations/Alerts/BESS's plain empty state. Everything
  // plant-dependent (revenue, current export, configured mode, event log,
  // last-telemetry timestamp) is simply omitted - never fabricated -
  // rather than rendering the full page with those fields permanently
  // "unavailable".
  if (organizationId === null) {
    const [data, t] = await Promise.all([
      getMarketPageData({
        organizationId: null,
        selectedDateParam: params.date,
        period,
        automationSettings: null,
      }),
      getTranslations("market"),
    ]);

    return (
      <PageContainer className="space-y-3">
        <MarketToolbar
          period={data.period}
          selectedDate={data.selectedDate}
          prevDateParam={data.prevDateParam}
          nextDateParam={data.nextDateParam}
          isToday={data.isToday}
          periodRangeLabel={data.periodRangeLabel}
        />

        {!data.dataAvailable ? (
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center">
            <p className="text-sm font-medium text-white">
              {t("noMarketData.title", { date: data.selectedDate })}
            </p>
            <p className="mt-1 text-xs text-slate-500">{t("noMarketData.description")}</p>
          </section>
        ) : (
          <>
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:p-4">
              <div>
                <h2 className="text-sm font-semibold text-white">{t("priceExport.titlePlatformWide")}</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {t("priceExport.subtitlePlatformWide")}
                </p>
              </div>

              <div className="mt-2.5 h-[200px] sm:h-[280px] lg:h-[320px] xl:h-[380px]">
                <Suspense fallback={<ChartSkeleton />}>
                  <DynamicMarketPriceChart
                    series={data.series}
                    thresholdPrice={data.threshold.minimumExportPrice}
                    showThreshold={period === "today"}
                    xAxisUnit={period === "today" ? "time" : period === "year" ? "month" : "day"}
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

  // Live Telemetry Synchronization Redesign milestone - see this file's
  // "Database-First Architecture milestone" comment further below for what
  // this is (and isn't) doing. Recovery-only, non-blocking; a no-op
  // whenever the scheduler already kept telemetry fresh.
  await ensureTelemetryFresh(organizationId, {
    mode: "background",
    onSettled: revalidateTelemetryPagesIfSynced,
  });

  // Checked before any other data fetching (ENTSO-E price import, revenue,
  // production telemetry) - none of that is plant-specific, so without a
  // plant this page would otherwise still render real market-price widgets
  // with every production-derived field permanently "unavailable". This is
  // a different, earlier gate than the existing `!data.dataAvailable`
  // check below, which stays as the empty state for "has a plant, but
  // ENTSO-E hasn't been imported for this day yet".
  const plantContext = await resolvePlantContext(organizationId);

  if (!plantContext) {
    const tEmpty = await getTranslations("market.emptyState");

    return (
      <PageContainer className="space-y-3">
        <EmptyState title={tEmpty("title")} description={tEmpty("description")}>
          {!readOnly && <ConnectFusionSolarButton />}
        </EmptyState>
      </PageContainer>
    );
  }

  // Database-First Architecture milestone: Market never blocks on a live
  // Huawei sync any more, for any period including today - it reads
  // whatever DeviceTelemetry/MarketPrice already holds. Freshness for
  // "today" primarily comes from the telemetry-ingestion scheduler (every
  // 15 minutes, 06:00-22:00 Europe/Sofia) and the login-triggered sync
  // (`lib/auth/config.ts`); the non-blocking `ensureTelemetryFresh` call
  // above is a recovery mechanism for when those missed a cycle, never a
  // wait inside this render.

  const automationSettings = await prisma.automationSettings.findUnique({
    where: { organizationId },
    select: { minimumExportPrice: true, currency: true, automationEnabled: true },
  });

  // Two completely independent data sources, composed only here — see
  // market-data.ts / production-data.ts module doc comments.
  const [data, production, currentExportMode, t, tSummary, tTerm] = await Promise.all([
    getMarketPageData({
      organizationId,
      selectedDateParam: params.date,
      period,
      automationSettings,
    }),
    getProductionPageData(organizationId, params.date, period),
    getStoredExportMode(organizationId),
    getTranslations("market"),
    getTranslations("market.summary"),
    getTranslations("terminology"),
  ]);

  const configuredMode = configuredModeStatus(
    automationSettings?.automationEnabled ?? false,
    currentExportMode,
    tSummary,
    tTerm,
  );

  const meterRevenue: RevenueSummary = data.dataAvailable
    ? computeExportRevenue(data.series, production.settlementEnergySeries)
    : { available: false };

  // Existing-Data Completeness milestone: a plant with no real meter has
  // no settlement-energy series to derive export revenue from, so
  // `meterRevenue` above is always unavailable for it. Falls back to the
  // exact same `computeExportRevenue` function, fed real measured
  // production (`production.productionEnergySeries`) instead of real
  // measured export — never estimated, just a different real measurement
  // priced the same way. A plant with a real meter (Atlanta) always
  // resolves `meterRevenue` successfully and never reaches this fallback.
  const productionRevenue: RevenueSummary =
    !meterRevenue.available && data.dataAvailable
      ? computeExportRevenue(
          data.series,
          production.productionEnergySeries.map((point) => ({
            intervalStart: point.intervalStart,
            exportedKwh: point.producedKwh,
            importedKwh: null,
          })),
        )
      : { available: false };

  const revenue: RevenueSummary = meterRevenue.available ? meterRevenue : productionRevenue;
  const revenueFromProduction = !meterRevenue.available && productionRevenue.available;
  const revenueEyebrow =
    data.dataAvailable && data.isToday ? t("summary.revenueToday") : t("summary.revenue");

  // Dashboard & Market Analytics milestone: reuses the exact same
  // `computeExportRevenue` above, just fed the previous calendar period's
  // price series (`market-data.ts`) and settlement series
  // (`production-data.ts`) instead of a second revenue implementation.
  // Both are only ever populated when `period !== "today"`.
  const previousRevenue: RevenueSummary =
    data.dataAvailable && data.previousPeriodSeries && production.previousPeriodSettlementEnergySeries
      ? computeExportRevenue(data.previousPeriodSeries, production.previousPeriodSettlementEnergySeries)
      : { available: false };
  const vsPreviousPeriodLabel: Record<"week" | "month" | "year", string> = {
    week: tSummary("vsLastWeek"),
    month: tSummary("vsLastMonth"),
    year: tSummary("vsLastYear"),
  };
  const revenueTrend =
    period !== "today"
      ? periodComparisonTrend(
          revenue.available ? revenue.revenueEur : null,
          previousRevenue.available ? previousRevenue.revenueEur : null,
          "EUR",
          vsPreviousPeriodLabel[period],
        )
      : undefined;

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
        ? { colorClass: "bg-emerald-400", label: tSummary("healthy") }
        : { colorClass: "bg-amber-400", label: tSummary("belowThreshold") }
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

  // Canonical Telemetry Architecture milestone: the Price & Export chart
  // visualizes real historical telemetry - it must never invent its own
  // production total. It reuses the exact same real 15-minute blocks
  // already computed for Revenue (`production.productionEnergySeries`)
  // whenever the meter-based series has no real data, the same fallback
  // Revenue itself already applies. A plant with a real meter (Atlanta)
  // always has real settlement data and never reaches this fallback.
  const hasMeterSettlementData = production.settlementEnergySeries.some(
    (point) => point.exportedKwh !== null,
  );
  const chartSettlementSeries: SettlementEnergyPoint[] = hasMeterSettlementData
    ? production.settlementEnergySeries
    : production.productionEnergySeries.map((point) => ({
        intervalStart: point.intervalStart,
        exportedKwh: point.producedKwh,
        importedKwh: null,
      }));

  return (
    <PageContainer className="space-y-3">
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <MarketToolbar
            period={data.period}
            selectedDate={data.selectedDate}
            prevDateParam={data.prevDateParam}
            nextDateParam={data.nextDateParam}
            isToday={data.isToday}
            periodRangeLabel={data.periodRangeLabel}
          />
        </div>
      </div>

      {!data.dataAvailable ? (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center">
          <p className="text-sm font-medium text-white">
            {t("noMarketData.title", { date: data.selectedDate })}
          </p>
          <p className="mt-1 text-xs text-slate-500">{t("noMarketData.description")}</p>
        </section>
      ) : (
        <>
          {data.isPartialImport && (
            <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs text-amber-300">
              {t("partialImportNotice")}
            </p>
          )}

          <section className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
            <MarketSummaryCard
              eyebrow={revenueEyebrow}
              value={
                revenue.available ? revenue.revenueEur.toFixed(2) : undefined
              }
              valueUnit={revenue.available ? "EUR" : undefined}
              unavailableNote={tSummary("waitingForProductionTelemetry")}
              trend={revenueTrend}
              rows={
                revenue.available
                  ? [
                      {
                        label: revenueFromProduction
                          ? data.isToday
                            ? tSummary("producedToday")
                            : tSummary("produced")
                          : data.isToday
                            ? tSummary("exportedToday")
                            : tSummary("exported"),
                        // Canonical Telemetry Architecture milestone: when
                        // Revenue falls back to the production-based
                        // calculation, the displayed kWh is the manufacturer-
                        // reported canonical total (`PlantDailyKpi.pvYieldKwh`,
                        // the exact same value Dashboard's own Yield Today/
                        // Total Yield read) - never the sum of only the
                        // settlement blocks that happened to have a matching
                        // price, which is a different (and always slightly
                        // smaller-or-equal) number. The EUR revenue figure
                        // itself is untouched - it still needs the real
                        // 15-minute blocks to price production against the
                        // price that applied at the time it happened.
                        value:
                          revenueFromProduction && production.dailyProduction !== null
                            ? `${production.dailyProduction.toFixed(2)} kWh`
                            : `${revenue.exportedKwh.toFixed(2)} kWh`,
                      },
                      {
                        label: tSummary("averageSellingPrice"),
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
              eyebrow={tSummary("currentPrice")}
              value={data.summary.currentPrice?.value.toString()}
              valueUnit={data.summary.currentPrice ? "EUR/MWh" : undefined}
              caption={data.summary.currentPrice?.intervalLabel}
              unavailableNote={tSummary("livePriceOnlyToday")}
              trend={currentPriceTrend}
            />

            <MarketSummaryCard
              eyebrow={tSummary("currentExport")}
              value={
                production.currentExport.available
                  ? production.currentExport.kw.toString()
                  : undefined
              }
              valueUnit={production.currentExport.available ? "kW" : undefined}
              unavailableNote={tSummary("fusionSolarMeterUnavailable")}
            />

            <MarketSummaryCard
              eyebrow={tSummary("configuredMode")}
              rows={[
                {
                  label: tTerm("automation"),
                  value: configuredMode.automationLabel,
                  valueColorClass: configuredMode.automationColorClass,
                },
                {
                  label: tSummary("currentModeRow"),
                  value: configuredMode.modeLabel,
                  valueColorClass: configuredMode.modeColorClass,
                },
              ]}
            />

            <MarketSummaryCard
              eyebrow={tTerm("threshold")}
              value={data.threshold.minimumExportPrice.toString()}
              valueUnit={`${data.threshold.currency}/MWh`}
              caption={tSummary("minimumProfitablePrice")}
              statusDot={thresholdStatusDot}
            />
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:p-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  {t("priceExport.title")}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {t("priceExport.subtitle")}
                </p>
              </div>
            </div>

            <div className="mt-2.5 h-[200px] sm:h-[280px] lg:h-[320px] xl:h-[380px]">
              <Suspense fallback={<ChartSkeleton />}>
                <DynamicMarketPriceChart
                  // Historical Analytics Refinement milestone: Today's blue
                  // line stays the real ENTSO-E price (`data.series`,
                  // unchanged); Week/Month/Year switch to the plant's real
                  // Average Selling Price per bucket (`buildAspChartSeries`)
                  // — a genuinely different business metric, never a
                  // relabeled copy of the same price values.
                  series={
                    period === "today"
                      ? data.series
                      : buildAspChartSeries(period, data.series, chartSettlementSeries)
                  }
                  thresholdPrice={data.threshold.minimumExportPrice}
                  // Export Threshold is an operational, today-only concept —
                  // never shown against a historical Average Selling Price.
                  showThreshold={period === "today"}
                  priceMetric={period === "today" ? "electricity" : "averageSelling"}
                  nowAnnotation={nowAnnotation}
                  xAxisUnit={period === "today" ? "time" : period === "year" ? "month" : "day"}
                  // production-data.ts computes this for whichever day is
                  // selected (the whole day if it's a past day, today-so-far
                  // if it's today) — historical days now render telemetry
                  // exactly like today, fixing the earlier "historical
                  // telemetry missing" bug (this used to be unconditionally
                  // suppressed for any non-today day). For Week/Month/Year,
                  // bucketed to one point per day/month via
                  // `bucketSettlementForChart`, applied to the exported-
                  // energy bars (the same real per-interval data
                  // `buildAspChartSeries` above also reads for the price
                  // line, just bucketed independently for its own purpose).
                  //
                  // Narrowed to the two fields MarketPriceChart actually
                  // reads — `importedKwh` is real data used elsewhere (KPI
                  // totals), just never by this chart, so it's dropped here
                  // rather than serialized into this prop for nothing.
                  settlementEnergySeries={
                    period === "today"
                      ? chartSettlementSeries.map(({ intervalStart, exportedKwh }) => ({
                          intervalStart,
                          exportedKwh,
                        }))
                      : bucketSettlementForChart(period, chartSettlementSeries)
                  }
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
