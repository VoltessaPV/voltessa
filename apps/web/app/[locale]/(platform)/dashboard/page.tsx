import { Suspense } from "react";
import { getTranslations } from "next-intl/server";

import { getStoredExportMode } from "@/lib/automation/automation-state";
import { resolveOrganizationViewAccess } from "@/lib/auth/session";
import { ensureTelemetryFresh } from "@/lib/fusionsolar/telemetry-sync-service";
import { ensureHistoricalRangeAvailable } from "@/lib/historical-data/ensure-day-available";
import { type CalendarPeriod, formatDateInZone, periodBoundsUtc } from "@/lib/market-price/timezone";
import { prisma } from "@/lib/prisma";

import { ChartSkeleton } from "@/components/charts/ChartSkeleton";
import { EnergyFlowDiagram } from "@/components/dashboard/EnergyFlowDiagram";
import { GlidepathCard } from "@/components/dashboard/GlidepathCard";
import { InvertersCard } from "@/components/dashboard/InvertersCard";
import { DynamicLiveEnergyChart } from "@/components/dashboard/LiveEnergyChart.dynamic";
import { WeatherCard } from "@/components/dashboard/WeatherCard";
import { MarketEventLog } from "@/components/market/MarketEventLog";
import { MarketSummaryCard } from "@/components/market/MarketSummaryCard";
import { MarketToolbar } from "@/components/market/MarketToolbar";
import { ConnectFusionSolarButton } from "@/components/platform/ConnectFusionSolarButton";
import { EmptyState } from "@/components/platform/EmptyState";
import { NoClientAssignedState } from "@/components/platform/NoClientAssignedState";
import { PageContainer } from "@/components/platform/layout/PageContainer";

import { getDashboardPageData } from "./dashboard-data";


/**
 * Design-System Consistency milestone: rebuilt from `market/page.tsx` (the
 * reference implementation), not evolved from the previous Dashboard. The
 * base layout below - outer container, header, KPI-row grid, chart-section
 * wrapper, bottom four-card grid - is Market's own skeleton, class for
 * class (`mx-auto max-w-7xl space-y-3`, the exact chart-section shadow,
 * `grid gap-2.5 lg:grid-cols-2 xl:grid-cols-4`). "Dashboard is Market plus
 * operational information": the only sections with no Market equivalent are
 * System Overview and Inverters, each its own section below the shared
 * skeleton, never patched into it.
 *
 * ## Dashboard UI Refinement (Final Design Pass) milestone
 *
 * UI/UX only — every value below still comes from `dashboard-data.ts`
 * unchanged (plus `totalYieldKwh`/`consumedFromPvKwh`, additive fields on
 * the same already-fetched data, see that module's doc comment). This pass
 * only changes: the top KPI row (six cards, Revenue dropped since it's
 * already shown on Market), global terminology (`Produced Today` -> `Yield
 * Today`, `Consumed Today` -> `Consumption Today`, `Exported Today` -> `Fed
 * to Grid`, `Imported Today` -> `From Grid` — see `LiveEnergyChart.tsx` for
 * the matching real-time-chart renames), and small icons on the bottom
 * cards' headers (via `lucide-react`, already a dependency).
 *
 * ## Dashboard visual refinement (FINAL PASS) milestone
 *
 * System Overview + Live Energy now share one row (35%/65% split, identical
 * height via CSS Grid's default stretch). The Market card
 * (`DashboardMarketWidget`, since removed — Revenue/price already live on
 * Market) is gone from the bottom row without a replacement; Inverters
 * moved into that same row instead of its own full-width section below, so
 * the bottom row is now exactly four equal cards: Weather, Forecast,
 * Inverters, Event Log. `data.market` (still computed in
 * `dashboard-data.ts`, untouched per this milestone's "don't touch the data
 * layer" constraint) is simply no longer rendered anywhere on this page.
 *
 * ## Dashboard UI polish (FINAL) milestone
 *
 * Reuses Market's own `MarketToolbar` (a `basePath` prop was added to that
 * shared component so it can navigate `/dashboard` instead of always
 * `/market` — not a second toolbar) for real day navigation, backed by
 * `dashboard-data.ts` now accepting `selectedDateParam` exactly like
 * `getMarketPageData`/`getProductionPageData` already do. Bottom row
 * reordered to Inverters, Weather, Forecast, Event Log (card sizes
 * unchanged). Total Yield is the one KPI displayed in MWh instead of kWh
 * (`mwhValueLabel`) — every other KPI stays kWh.
 *
 * ## Dashboard UI final polish milestone
 *
 * "Waiting for telemetry" is honest for *today* (data is genuinely still
 * arriving) but misleading for a past day that simply has no stored row —
 * `unavailableNote` below picks friendlier, accurate wording for that case
 * ("Historical data not available", or a more specific variant matching
 * this milestone's examples) without ever hiding a real historical value
 * that *does* exist (every KPI here still just renders whatever
 * `dashboard-data.ts` returns — `null` only when a row is genuinely
 * absent, real historical rows render exactly like today's).
 *
 * ## Fixed Header Architecture milestone
 *
 * The eyebrow/title block that used to open this page's own JSX now
 * renders once inside `AppHeader` (via `PageHeading`, which resolves this
 * route's translated copy from `navigation.pageHeadings` - see
 * `components/platform/layout/page-headings.ts`, Full Internationalization
 * milestone) instead of here - this page starts directly with `MarketToolbar`.
 *
 * ## Transparent Freshness milestone
 *
 * The manual Refresh button is gone - Dashboard now blocks on
 * `ensureTelemetryFresh` (`lib/fusionsolar/telemetry-sync-service.ts`)
 * before loading page data, so every render already reflects telemetry no
 * more than `FUSIONSOLAR_SYNC_FRESHNESS_MS` old, transparently. Market
 * does the identical thing; Settings/Automations/Alerts/Plants call the
 * same helper in background mode instead, since they render no telemetry
 * and must never wait on Huawei. `resolvePlantContext` (called inside
 * `getDashboardPageData` below) no longer has any synchronization
 * side effect of its own - see its doc comment.
 */

/**
 * Full date+time, always in Europe/Sofia — never the bare
 * `.toLocaleString()` default, which would render in the server's own
 * timezone (UTC on Vercel) rather than the plant's real local time.
 */
function sofiaDateTimeLabel(date: Date): string {
  return date.toLocaleString("en-GB", { timeZone: "Europe/Sofia" });
}

function energyValueLabel(kwh: number | null): string | undefined {
  return kwh !== null ? kwh.toFixed(1) : undefined;
}

/** Total Yield only — the one KPI shown in MWh instead of kWh, per this milestone's explicit formatting requirement. */
function mwhValueLabel(kwh: number | null): string | undefined {
  return kwh !== null ? (kwh / 1000).toFixed(1) : undefined;
}

/**
 * Friendlier, date-aware unavailable wording — `todayNote` only ever
 * applies when the selected day genuinely is today. Historical Data
 * Auto-Import milestone: `importFailed` distinguishes "we tried to import
 * this day and it genuinely failed" from "nothing to show" - per that
 * milestone's explicit requirement, the failure message must only ever
 * appear after a real import attempt failed, never merely because import
 * hasn't been attempted (which, since `ensureHistoricalDayAvailable` is
 * always awaited before this page renders, never happens for a past day
 * anymore).
 */
function unavailableNote(
  isToday: boolean,
  todayNote: string,
  historicalNote: string,
  importFailed = false,
  importFailedNote?: string,
): string {
  if (isToday) {
    return todayNote;
  }
  return importFailed && importFailedNote ? importFailedNote : historicalNote;
}

function parsePeriod(value: string | undefined): CalendarPeriod {
  return value === "week" || value === "month" || value === "year" ? value : "today";
}

/** Same pattern as `dashboard-data.ts`'s own `isValidDateString` - duplicated per this codebase's established convention for small, page-local date-handling helpers rather than shared. */
function isValidDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

const BULGARIA_TIMEZONE = "Europe/Sofia";

type Trend = "up" | "down" | "flat";

/**
 * Dashboard & Market Analytics milestone (Weekly/Monthly/Yearly). ▲/▼ +
 * absolute + percentage difference versus the previous calendar period —
 * reuses `MarketSummaryCard`'s existing `trend` prop, same computation
 * `market/page.tsx`'s own `periodComparisonTrend` uses (duplicated, not
 * imported — matching this codebase's established precedent for small,
 * page-local presentation helpers, see `dashboard-data.ts`'s own doc
 * comment on why date-handling helpers are duplicated rather than shared).
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

type DashboardPageProps = {
  searchParams: Promise<{ date?: string; period?: string }>;
};

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
  // Trader Workflow Simplification milestone. Dashboard is no longer
  // portfolio-level for a Trader - that view moved to Clients (see
  // `TraderPortfolioSummary`). Dashboard now resolves the currently
  // selected client exactly like Market/BESS/Automations/Alerts already
  // do, via the same shared helper, and renders the identical Plant Owner
  // experience below for whichever organization that resolves to - no
  // special Trader layout, no reduced functionality. `readOnly` suppresses
  // the "Connect Plant" CTA in the empty state below, same as every other
  // page that uses this helper. `organizationId` is null only for a Trader
  // with zero assigned clients - a plain empty state, not a redirect, so
  // the rest of the workspace (Clients, Market, ...) stays reachable.
  const { organizationId, readOnly } = await resolveOrganizationViewAccess();

  if (organizationId === null) {
    return (
      <PageContainer className="space-y-3">
        <NoClientAssignedState />
      </PageContainer>
    );
  }

  const params = await searchParams;
  const period = parsePeriod(params.period);

  // Historical Data Coverage milestone: the selected period - a single
  // past day, or a Week/Month/Year range - must never render "no
  // historical data" just because nothing has been imported for it yet.
  // `periodBoundsUtc` resolves the exact same [start, end) Dashboard's own
  // data layer uses for this period; `ensureHistoricalRangeAvailable`
  // itself already no-ops for a range that's entirely today/future (e.g.
  // period "today" on today's own date), so this one call correctly covers
  // every period without a separate today/historical branch. Awaited here,
  // before any page data is fetched, so `getDashboardPageData` below always
  // reads a period that's already fully imported (or has run out of its
  // own safety time budget - see that function's doc comment); the route's
  // `loading.tsx` is what the user sees while this runs.
  const todayDateStr = formatDateInZone(new Date(), BULGARIA_TIMEZONE);
  const selectedDateStr =
    params.date && isValidDateString(params.date) ? params.date : todayDateStr;
  const referenceInstant = new Date(`${selectedDateStr}T12:00:00Z`);
  const { start: periodStart, end: periodEnd } = periodBoundsUtc(period, referenceInstant, BULGARIA_TIMEZONE);

  const historicalRange = await ensureHistoricalRangeAvailable({
    organizationId,
    start: periodStart,
    end: periodEnd,
  });

  // Transparent Freshness milestone: Dashboard renders telemetry, so it
  // blocks on synchronization instead of showing a possibly-stale snapshot
  // - see ensureTelemetryFresh's own doc comment for why this, and only
  // this, decides whether/how a sync runs. No cache invalidation needed
  // here: this route is fully dynamic (uses cookies() via
  // requireOnboardedUser/requireTraderOrganizationAccess, confirmed by the
  // build output showing `ƒ`, not `○`), so it's never in the Full Route
  // Cache, and the client Router Cache doesn't hold dynamic segments by
  // default (no staleTimes override in next.config.js) -
  // getDashboardPageData below already reads live database state
  // regardless, with nothing cached anywhere to invalidate.
  await ensureTelemetryFresh(organizationId, { mode: "blocking" });

  const automationSettings = await prisma.automationSettings.findUnique({
    where: { organizationId },
    select: { minimumExportPrice: true, currency: true, automationEnabled: true },
  });

  const [data, currentExportMode, t] = await Promise.all([
    getDashboardPageData(organizationId, automationSettings, params.date, period),
    getStoredExportMode(organizationId),
    getTranslations("dashboard"),
  ]);

  // Inverters card's subtle Zero Export badge - see InvertersCard's own
  // doc comment. Same automation-state source as Market's Configured Mode
  // card (AutomationSettings.automationEnabled + AutomationState.currentExportMode).
  const zeroExportActive =
    (automationSettings?.automationEnabled ?? false) &&
    currentExportMode === "Zero Export";

  // Dashboard & Market Analytics milestone: ▲/▼ comparisons vs. the
  // previous calendar week/month/year — only present (non-undefined) when
  // `data.plantAvailable && period !== "today"`, per `getDashboardPageData`'s
  // own doc comment.
  const previousKpis = data.plantAvailable ? data.previousPeriodKpis : undefined;
  const vsPreviousPeriodLabel: Record<"week" | "month" | "year", string> =
    period !== "today"
      ? {
          week: t("comparison.vsLastWeek"),
          month: t("comparison.vsLastMonth"),
          year: t("comparison.vsLastYear"),
        }
      : { week: "", month: "", year: "" };
  const comparisonSuffix = period !== "today" ? vsPreviousPeriodLabel[period] : "";

  const producedTrend = previousKpis
    ? periodComparisonTrend(
        data.plantAvailable ? data.kpis.producedTodayKwh : null,
        previousKpis.producedKwh,
        "kWh",
        comparisonSuffix,
      )
    : undefined;
  const consumedTrend = previousKpis
    ? periodComparisonTrend(
        data.plantAvailable ? data.kpis.consumedTodayKwh : null,
        previousKpis.consumedKwh,
        "kWh",
        comparisonSuffix,
      )
    : undefined;
  const consumedFromPvTrend = previousKpis
    ? periodComparisonTrend(
        data.plantAvailable ? data.kpis.consumedFromPvKwh : null,
        previousKpis.consumedFromPvKwh,
        "kWh",
        comparisonSuffix,
      )
    : undefined;
  const exportedTrend = previousKpis
    ? periodComparisonTrend(
        data.plantAvailable ? data.kpis.exportedTodayKwh : null,
        previousKpis.exportedKwh,
        "kWh",
        comparisonSuffix,
      )
    : undefined;
  const importedTrend = previousKpis
    ? periodComparisonTrend(
        data.plantAvailable ? data.kpis.importedTodayKwh : null,
        previousKpis.importedKwh,
        "kWh",
        comparisonSuffix,
      )
    : undefined;

  // Historical Data Coverage milestone: true only if at least one day in
  // the selected period (awaited above, via `ensureHistoricalRangeAvailable`)
  // genuinely attempted and failed to import this specific piece - never
  // true just because a day hasn't been imported yet (that's either
  // already resolved before this render, or - for a very large range that
  // ran past its safety time budget - simply not attempted yet this time,
  // which reports as "not available" with no error, not a failure).
  const dailyKpiImportFailed = historicalRange.days.some((day) => day.dailyKpiError !== null);
  const telemetryImportFailed = historicalRange.days.some((day) => day.telemetryError !== null);

  return (
    <PageContainer className="space-y-3">
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <MarketToolbar
            basePath="/dashboard"
            period={data.period}
            selectedDate={data.selectedDate}
            prevDateParam={data.prevDateParam}
            nextDateParam={data.nextDateParam}
            isToday={data.isToday}
            periodRangeLabel={data.periodRangeLabel}
          />
        </div>
      </div>

      {!data.plantAvailable ? (
        <EmptyState title={t("emptyState.title")} description={t("emptyState.description")}>
          {!readOnly && <ConnectFusionSolarButton />}
        </EmptyState>
      ) : (
        <>
          <section className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
            <MarketSummaryCard
              eyebrow={period === "today" ? t("kpis.yieldToday") : t("kpis.yield")}
              value={energyValueLabel(data.kpis.producedTodayKwh)}
              valueUnit={
                data.kpis.producedTodayKwh !== null ? "kWh" : undefined
              }
              unavailableNote={unavailableNote(
                data.isToday,
                t("kpis.waitingForTelemetry"),
                t("kpis.noHistoricalProductionData"),
                dailyKpiImportFailed,
                t("kpis.historicalImportFailed"),
              )}
              trend={producedTrend}
            />

            <MarketSummaryCard
              eyebrow={t("kpis.totalYield")}
              value={mwhValueLabel(data.kpis.totalYieldKwh)}
              valueUnit={data.kpis.totalYieldKwh !== null ? "MWh" : undefined}
              unavailableNote={unavailableNote(
                data.isToday,
                t("kpis.notAvailable"),
                t("kpis.historicalDataNotAvailable"),
                dailyKpiImportFailed,
                t("kpis.historicalImportFailed"),
              )}
            />

            <MarketSummaryCard
              eyebrow={period === "today" ? t("kpis.consumptionToday") : t("kpis.consumption")}
              value={energyValueLabel(data.kpis.consumedTodayKwh)}
              valueUnit={
                data.kpis.consumedTodayKwh !== null ? "kWh" : undefined
              }
              unavailableNote={unavailableNote(
                data.isToday,
                t("kpis.waitingForTelemetry"),
                t("kpis.historicalDataNotAvailable"),
                dailyKpiImportFailed,
                t("kpis.historicalImportFailed"),
              )}
              trend={consumedTrend}
            />

            <MarketSummaryCard
              eyebrow={t("kpis.consumedFromPv")}
              value={energyValueLabel(data.kpis.consumedFromPvKwh)}
              valueUnit={
                data.kpis.consumedFromPvKwh !== null ? "kWh" : undefined
              }
              unavailableNote={unavailableNote(
                data.isToday,
                t("kpis.waitingForTelemetry"),
                t("kpis.historicalDataNotAvailable"),
                dailyKpiImportFailed || telemetryImportFailed,
                t("kpis.historicalImportFailed"),
              )}
              trend={consumedFromPvTrend}
            />

            <MarketSummaryCard
              eyebrow={t("kpis.fedToGrid")}
              value={energyValueLabel(data.kpis.exportedTodayKwh)}
              valueUnit={
                data.kpis.exportedTodayKwh !== null ? "kWh" : undefined
              }
              unavailableNote={unavailableNote(
                data.isToday,
                t("kpis.waitingForTelemetry"),
                t("kpis.historicalDataNotAvailable"),
                telemetryImportFailed,
                t("kpis.historicalImportFailed"),
              )}
              trend={exportedTrend}
            />

            <MarketSummaryCard
              eyebrow={t("kpis.fromGrid")}
              value={energyValueLabel(data.kpis.importedTodayKwh)}
              trend={importedTrend}
              valueUnit={
                data.kpis.importedTodayKwh !== null ? "kWh" : undefined
              }
              unavailableNote={unavailableNote(
                data.isToday,
                t("kpis.waitingForTelemetry"),
                t("kpis.historicalDataNotAvailable"),
                telemetryImportFailed,
                t("kpis.historicalImportFailed"),
              )}
            />
          </section>

          <section className="grid gap-2.5 lg:grid-cols-[30%_1fr]">
            <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:p-4">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  {t("systemOverview.title")}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {t("systemOverview.subtitle")}
                </p>
              </div>

              <div className="mt-2 min-h-0 flex-1">
                <EnergyFlowDiagram
                  flow={data.energyFlow}
                  isToday={data.isToday}
                />
              </div>
            </div>

            <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:p-4">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  {t("liveEnergy.title")}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {t("liveEnergy.subtitle")}
                </p>
              </div>

              <div className="mt-2.5 h-[220px] sm:h-[280px] lg:h-[320px] xl:h-[360px]">
                <Suspense fallback={<ChartSkeleton />}>
                  <DynamicLiveEnergyChart
                    data={data.chartSeries}
                    nowAnnotation={data.nowAnnotation}
                    unit={data.chartUnit}
                    xAxisUnit={period === "today" ? "time" : period === "year" ? "month" : "day"}
                  />
                </Suspense>
              </div>
            </div>
          </section>

          <section className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
            <InvertersCard inverters={data.inverters} zeroExportActive={zeroExportActive} />
            <WeatherCard weather={data.weather} />
            <GlidepathCard />
            <MarketEventLog entries={data.eventLog} />
          </section>
        </>
      )}

      <p className="text-xs text-slate-500">
        {t("lastTelemetry.label")}{" "}
        <span className="text-slate-300">
          {data.plantAvailable && data.latestTelemetryAt
            ? sofiaDateTimeLabel(data.latestTelemetryAt)
            : t("lastTelemetry.noData")}
        </span>
      </p>
    </PageContainer>
  );
}
