/**
 * Market page's production-side orchestration — completely independent
 * from `market-data.ts` (the ENTSO-E orchestration). Neither imports the
 * other; `page.tsx` calls both and composes the results. This keeps the
 * Market Price Provider and the telemetry/FusionSolar integration
 * decoupled, per this milestone's architecture requirement.
 *
 * Database-First Telemetry Architecture milestone: this module no longer
 * calls Huawei at all, directly or indirectly — it never imports
 * `lib/fusionsolar/telemetry-sync-service.ts` either. `currentProduction`/
 * `currentExport`/`currentImport` now come from `DeviceTelemetry`'s newest
 * row per device (via `lib/telemetry/queries.ts`). Only ever computed for
 * `isToday`, matching this page's existing convention: "current" has no
 * meaning for a browsed historical day, independent of where the data
 * comes from.
 *
 * Repository-Layer Deduplication milestone: plant/connection resolution
 * moved to `lib/telemetry/plant-context.ts`'s `resolvePlantContext`,
 * called exactly once. When called directly (Market's own page load),
 * this function resolves everything itself, exactly as before — the
 * `getProductionPageData(organizationId, selectedDateParam)` two-argument
 * call is unchanged and self-sufficient. When called *from* Dashboard
 * (which already resolved the same plant/connection and already fetched
 * the same inverter telemetry for its own Inverters card), an optional
 * third `preloaded` argument lets this function skip re-resolving and
 * re-fetching data Dashboard already has — this is what eliminates the
 * cross-page duplicate `Plant`/`FusionSolarConnection`/inverter-telemetry
 * queries the Prisma trace measured.
 *
 * `configuredExportMode` has no persisted equivalent yet (deferred to a
 * later milestone) — it always renders the same explicit "unavailable"
 * state already shown in production today (the underlying endpoint has
 * stood at `failCode 20609` for this plant throughout the whole
 * investigation, see `docs/research/fusionsolar-active-power-control.md`),
 * so this is a zero-regression simplification, not a feature removal.
 *
 * `settlementEnergySeries` (`lib/telemetry/energy-metrics.ts`) remains
 * `DeviceTelemetry`-only, as it already was.
 *
 * Final Market UX Completion milestone: this module used to also expose
 * `todaysProduction`/`peakExportToday`/`exportedEnergyToday` and a
 * `telemetryInsights` bullet list built from them ("Today's production",
 * "Maximum export today", "Exported energy") for the Market Insights
 * card. Removed entirely — Market Insights is now market intelligence
 * only (price statistics from `market-data.ts`); those same figures
 * already live on the Dashboard (the operational monitoring page) and,
 * for exported energy, on Market's own Revenue card. Duplicating them
 * in the Insights list too contradicted the Dashboard/Market split this
 * milestone reinforces. `computePlantEnergyMetrics` is no longer called
 * here at all as a result — `settlementEnergySeries`
 * (`getPlantSettlementEnergySeries`) is the only telemetry read this
 * module still needs, for the chart and the Revenue calculation in
 * `page.tsx`.
 *
 * Read-only either way: nothing here ever writes to Huawei, changes an
 * export limit, or modifies plant configuration.
 *
 * ## Date-awareness (Historical Backfill + Timeline Alignment /
 * Mathematical Correctness milestone)
 *
 * `settlementEnergySeries` used to be computed unconditionally for
 * "right now" — regardless of which day the Market toolbar had selected —
 * and `page.tsx` additionally hid the chart's telemetry overlay entirely
 * whenever a past day was selected. Both were root causes of "historical
 * telemetry missing": once DeviceTelemetry actually contained a week of
 * real backfilled data, there was no code path left that would ever
 * display it. This module computes the exact same
 * selectedDate/isToday/Europe-Sofia-day-bounds logic as `market-data.ts`
 * (duplicated, not imported — see this module's independence note above)
 * so the two pages' data always describes the same day, and
 * `settlementEnergySeries` covers the *whole* selected day (not just
 * "today so far") whenever it isn't actually today.
 */

import {
  describeConfiguredExportMode,
  type ConfiguredExportControlMode,
} from "@/lib/fusionsolar/get-export-control-status";
import {
  formatDateInZone,
  periodBoundsUtc,
  previousPeriodBoundsUtc,
  type CalendarPeriod,
} from "@/lib/market-price/timezone";
import { prisma } from "@/lib/prisma";
import {
  getPlantProductionEnergySeries,
  getPlantSettlementEnergySeries,
  type ProductionEnergyPoint,
  type SettlementEnergyPoint,
} from "@/lib/telemetry/energy-metrics";
import {
  getCurrentGridReadings,
  getCurrentProduction,
  getDailyTotals,
  getLatestInverterTelemetryForDevices,
  getLatestMeterTelemetry,
  type CanonicalReading,
  type LatestInverterRow,
} from "@/lib/telemetry/canonical";
import { getLatestTelemetryTimestamp, INVERTER_DEV_TYPE_ID } from "@/lib/telemetry/queries";
import { resolvePlantContext, type PlantRenderContext } from "@/lib/telemetry/plant-context";

/** Same Sofia local-day convention `market-data.ts` uses for the Market page's displayed day — duplicated intentionally, see this module's doc comment. */
const BULGARIA_TIMEZONE = "Europe/Sofia";

function isValidDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export type ProductionPageData = {
  currentProduction: CanonicalReading;
  currentExport: CanonicalReading;
  currentImport: CanonicalReading;
  configuredExportMode: ConfiguredExportControlMode;
  configuredExportModeLabel: { label: string; colorClass: string };
  /**
   * Real exported/imported energy per 15-minute settlement interval for
   * the *selected* day (the whole day if it's a past day; today-so-far if
   * it's today) — derived from the meter's real cumulative energy
   * counters, never from power integration (see energy-metrics.ts's doc
   * comment). Aligned to the exact same Europe/Sofia 15-minute grid as
   * `market-data.ts`'s price series, so the Market chart (and
   * `page.tsx`'s revenue calculation) can merge them by timestamp with no
   * resampling. Empty only when no plant/telemetry exists for this
   * organization.
   */
  settlementEnergySeries: SettlementEnergyPoint[];
  /**
   * Existing-Data Completeness milestone: real produced energy per
   * 15-minute interval for the *selected* day, for plants with no real
   * meter counter (`getPlantProductionEnergySeries` — the production-only
   * counterpart to `settlementEnergySeries` above, same 15-minute grid).
   * `page.tsx` uses this only as a fallback for Revenue when the real
   * meter-based `settlementEnergySeries` has nothing to offer — a plant
   * with a real meter (Atlanta) always has real `settlementEnergySeries`
   * data and never reaches this fallback.
   */
  productionEnergySeries: ProductionEnergyPoint[];
  /**
   * Canonical Telemetry Architecture milestone. The manufacturer-reported
   * daily production for the *selected* period, via
   * `lib/telemetry/canonical.ts`'s `getDailyTotals` — the exact same
   * canonical access layer `dashboard-data.ts` reads for its own "Yield
   * Today"/"Total Yield" KPIs, never `PlantDailyKpi` directly. Huawei
   * already reports this total directly (`getStationRealKpi`'s
   * `day_power` / `getKpiStationDay`'s `PVYield`) — Voltessa must not
   * recompute an alternative total from raw telemetry when the
   * manufacturer already provides one. `page.tsx` displays this value
   * (never `revenue.exportedKwh`, the settlement-block sum) as the
   * "Produced" row whenever Revenue falls back to the production-based
   * calculation, so Market and Dashboard always show the identical
   * number for the identical plant/period. `null` only when no
   * canonical daily record exists yet for the selected period.
   */
  dailyProduction: number | null;
  /**
   * Dashboard & Market Analytics milestone (Weekly/Monthly/Yearly). The
   * same shape as `settlementEnergySeries`, but for the previous calendar
   * period (previous week/month/year) — fetched only when `period !==
   * "today"`, since that's the only case anything needs a period-over-
   * period comparison. `page.tsx` feeds this into the same
   * `computeExportRevenue` the current period already uses, rather than a
   * second revenue calculation.
   */
  previousPeriodSettlementEnergySeries?: SettlementEnergyPoint[];
  /**
   * The plant's configured installed capacity (`Plant.capacityKw`), read
   * directly from the database — never hardcoded, never derived from
   * telemetry. `null` only when the plant has no `capacityKw` configured
   * or doesn't exist; the chart must not fabricate an engineering scale
   * when this is unknown.
   */
  installedCapacityKw: number | null;
  /**
   * Timestamp of the single newest real `DeviceTelemetry` row for this
   * plant (any device type) — queried directly via
   * `getLatestTelemetryTimestamp`, never derived/guessed from
   * `settlementEnergySeries` (whose last entry can be `null`-valued if
   * telemetry hasn't caught up to the current settlement interval yet).
   * This is what the Market page's "Last update" actually means (Final
   * Market UX Completion milestone): it used to show the ENTSO-E
   * price-import timestamp, which is largely static (ENTSO-E publishes
   * each day's prices once) and was found to be hours staler than the
   * telemetry actually driving the chart/revenue figures — traced Huawei
   * → DeviceTelemetry → this field → the Market Info card, confirmed via
   * direct query (price import ~278 minutes stale vs. telemetry ~6
   * minutes stale at the same instant). Always computed regardless of
   * which day is selected — it describes the telemetry pipeline's own
   * freshness, not the browsed day. `null` only when no plant/telemetry
   * exists at all.
   */
  latestTelemetryAt: Date | null;
};

const UNAVAILABLE_NO_TELEMETRY: CanonicalReading = {
  available: false,
  reason: "no_telemetry",
};

/**
 * Configured Export Mode has no persisted equivalent yet (Database-First
 * Telemetry Architecture milestone — deferred to a later milestone). This
 * is a static fallback, not a degraded-path value: it always renders,
 * matching this endpoint's own already-standing production behavior
 * (`failCode 20609`, confirmed throughout the whole Active Power Control
 * investigation).
 */
const UNAVAILABLE_NO_CONNECTION_MODE: ConfiguredExportControlMode = {
  available: false,
  reason: "configuration_endpoint_failed",
};

/**
 * Data Dashboard already resolved/fetched for the same request — passing
 * it in skips this function's own equivalent (and otherwise redundant)
 * `Plant`/`FusionSolarConnection`/inverter-telemetry queries. Optional and
 * additive only: Market's own direct page load never provides this and
 * behaves exactly as before.
 */
export type ProductionPagePreload = {
  context: PlantRenderContext;
  /** Already-fetched latest telemetry for every inverter device under `context.plant` — reused for `currentProduction` instead of being queried again. */
  inverterTelemetry: LatestInverterRow[];
};

export async function getProductionPageData(
  organizationId: string,
  selectedDateParam: string | undefined,
  period: CalendarPeriod = "today",
  preloaded?: ProductionPagePreload,
): Promise<ProductionPageData> {
  const todayDateStr = formatDateInZone(new Date(), BULGARIA_TIMEZONE);
  const selectedDate =
    selectedDateParam && isValidDateString(selectedDateParam)
      ? selectedDateParam
      : todayDateStr;
  const referenceInstant = new Date(`${selectedDate}T12:00:00Z`);

  // Category A ("current" readings — inverter/meter power right now) only
  // ever describes the literal "today" period, never "this week/month/
  // year" even when that period happens to contain today — "current state"
  // isn't a period-aggregate concept. Matches this module's existing
  // single-day convention exactly (a browsed historical day already never
  // showed Category A either).
  const isToday = period === "today" && selectedDate === todayDateStr;

  const { start: periodStart, end: periodEnd } = periodBoundsUtc(
    period,
    referenceInstant,
    BULGARIA_TIMEZONE,
  );
  const now = new Date();
  // Never show future data for an in-progress period; a period that's
  // already fully elapsed uses its whole span; a period entirely in the
  // future (browsing ahead) collapses to an empty window rather than a
  // negative one.
  const seriesEnd = now < periodStart ? periodStart : now < periodEnd ? now : periodEnd;

  const context = preloaded
    ? preloaded.context
    : await resolvePlantContext(organizationId);

  // Read directly from the plant's own configuration — never hardcoded,
  // never derived from telemetry. `null` only when genuinely unconfigured.
  const installedCapacityKw = context?.plant.capacityKw
    ? Number(context.plant.capacityKw.toString())
    : null;

  if (!context) {
    return {
      currentProduction: UNAVAILABLE_NO_TELEMETRY,
      currentExport: UNAVAILABLE_NO_TELEMETRY,
      currentImport: UNAVAILABLE_NO_TELEMETRY,
      configuredExportMode: UNAVAILABLE_NO_CONNECTION_MODE,
      configuredExportModeLabel: describeConfiguredExportMode(
        UNAVAILABLE_NO_CONNECTION_MODE,
      ),
      settlementEnergySeries: [],
      productionEnergySeries: [],
      dailyProduction: null,
      installedCapacityKw,
      latestTelemetryAt: null,
    };
  }

  // Category B (settlement series/latest timestamp) and Category A
  // (current inverter/meter readings) don't depend on each other's
  // results — both were previously fetched as two separate sequential
  // `Promise.all` groups; merged into one, gated the same way each
  // branch already was (Category A only for `isToday`, unchanged).
  const [series, productionSeries, dailyTotals, latestTimestamp, inverterRows, meterRow, previousPeriodSeries] =
    await Promise.all([
      getPlantSettlementEnergySeries(context.plant.id, periodStart, seriesEnd),
      getPlantProductionEnergySeries(context.plant.id, periodStart, seriesEnd),
      getDailyTotals(context.plant.id, periodStart, periodEnd),
      getLatestTelemetryTimestamp(context.plant.id),
      isToday
        ? preloaded
          ? Promise.resolve(preloaded.inverterTelemetry)
          : (async () => {
              const inverterDevices = await prisma.device.findMany({
                where: { plantId: context.plant.id, devTypeId: INVERTER_DEV_TYPE_ID },
                select: { id: true },
              });
              return getLatestInverterTelemetryForDevices(
                inverterDevices.map((device) => device.id),
              );
            })()
        : Promise.resolve([]),
      isToday ? getLatestMeterTelemetry(context.plant.id) : Promise.resolve(null),
      // Dashboard & Market Analytics milestone: only the previous calendar
      // period's settlement series is ever needed for a period-over-period
      // Revenue comparison — "today" has no such comparison in this
      // module's existing single-day design, so this is skipped entirely
      // for it (matching "today"'s existing zero-extra-query behavior).
      period === "today"
        ? Promise.resolve(undefined)
        : (() => {
            const { start: previousStart, end: previousEnd } = previousPeriodBoundsUtc(
              period,
              periodStart,
              BULGARIA_TIMEZONE,
            );
            return getPlantSettlementEnergySeries(context.plant.id, previousStart, previousEnd);
          })(),
    ]);

  const settlementEnergySeries = series;
  const productionEnergySeries = productionSeries;
  const dailyProduction = dailyTotals.available ? dailyTotals.dailyProduction : null;
  const latestTelemetryAt = latestTimestamp;

  // Category A — "current" state, database-only (Database-First Telemetry
  // Architecture milestone). Only ever computed for `isToday` — "current
  // production" has no meaning while browsing a historical day or any
  // non-"today" period, independent of where the value comes from.
  if (!isToday) {
    return {
      currentProduction: UNAVAILABLE_NO_TELEMETRY,
      currentExport: UNAVAILABLE_NO_TELEMETRY,
      currentImport: UNAVAILABLE_NO_TELEMETRY,
      configuredExportMode: UNAVAILABLE_NO_CONNECTION_MODE,
      configuredExportModeLabel: describeConfiguredExportMode(
        UNAVAILABLE_NO_CONNECTION_MODE,
      ),
      settlementEnergySeries,
      productionEnergySeries,
      dailyProduction,
      previousPeriodSettlementEnergySeries: previousPeriodSeries,
      installedCapacityKw,
      latestTelemetryAt,
    };
  }

  const currentProduction = getCurrentProduction(inverterRows);
  const { currentExport, currentImport } = getCurrentGridReadings(meterRow, currentProduction);

  return {
    currentProduction,
    currentExport,
    currentImport,
    configuredExportMode: UNAVAILABLE_NO_CONNECTION_MODE,
    configuredExportModeLabel: describeConfiguredExportMode(
      UNAVAILABLE_NO_CONNECTION_MODE,
    ),
    settlementEnergySeries,
    productionEnergySeries,
    dailyProduction,
    installedCapacityKw,
    latestTelemetryAt,
  };
}
