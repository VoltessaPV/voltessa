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
 * row per device (via `lib/telemetry/queries.ts`, which transparently
 * ensures the connection is synchronized before returning — this module
 * simply asks for telemetry). Only ever computed for `isToday`, matching
 * this page's existing convention: "current" has no meaning for a browsed
 * historical day, independent of where the data comes from.
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
  localDayBoundsUtc,
} from "@/lib/market-price/timezone";
import { prisma } from "@/lib/prisma";
import {
  getPlantSettlementEnergySeries,
  type SettlementEnergyPoint,
} from "@/lib/telemetry/energy-metrics";
import {
  getLatestInverterTelemetry,
  getLatestMeterTelemetry,
  getLatestTelemetry,
} from "@/lib/telemetry/queries";

/** Same Sofia local-day convention `market-data.ts` uses for the Market page's displayed day — duplicated intentionally, see this module's doc comment. */
const BULGARIA_TIMEZONE = "Europe/Sofia";

function isValidDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export type ProductionReading =
  | { available: true; kw: number }
  | { available: false; reason: string };

export type ProductionPageData = {
  currentProduction: ProductionReading;
  currentExport: ProductionReading;
  currentImport: ProductionReading;
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
   * The plant's configured installed capacity (`Plant.capacityKw`), read
   * directly from the database — never hardcoded, never derived from
   * telemetry. `null` only when the plant has no `capacityKw` configured
   * or doesn't exist; the chart must not fabricate an engineering scale
   * when this is unknown.
   */
  installedCapacityKw: number | null;
  /**
   * Timestamp of the single newest real `DeviceTelemetry` row for this
   * plant (any device type) — queried directly via `getLatestTelemetry`,
   * never derived/guessed from `settlementEnergySeries` (whose last entry
   * can be `null`-valued if telemetry hasn't caught up to the current
   * settlement interval yet). This is what the Market page's "Last
   * update" actually means (Final Market UX Completion milestone): it
   * used to show the ENTSO-E price-import timestamp, which is largely
   * static (ENTSO-E publishes each day's prices once) and was found to be
   * hours staler than the telemetry actually driving the chart/revenue
   * figures — traced Huawei → DeviceTelemetry → this field → the Market
   * Info card, confirmed via direct query (price import ~278 minutes
   * stale vs. telemetry ~6 minutes stale at the same instant). Always
   * computed regardless of which day is selected — it describes the
   * telemetry pipeline's own freshness, not the browsed day. `null` only
   * when no plant/telemetry exists at all.
   */
  latestTelemetryAt: Date | null;
};

const UNAVAILABLE_NO_TELEMETRY: ProductionReading = {
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

/** Sum of every inverter's newest `activePower` sample — mirrors the former live `getInverterProductionKw`'s shape, sourced from `DeviceTelemetry` instead. */
function sumInverterProduction(
  rows: Array<{ activePower: { toNumber(): number } | null }>,
): ProductionReading {
  const readings = rows
    .map((row) => (row.activePower !== null ? row.activePower.toNumber() : null))
    .filter((kw): kw is number => kw !== null);

  if (readings.length === 0) {
    return UNAVAILABLE_NO_TELEMETRY;
  }

  const totalKw = Math.round(readings.reduce((sum, kw) => sum + kw, 0) * 100) / 100;

  return { available: true, kw: totalKw };
}

/** Signed meter reading -> export/import pair — mirrors the former live `getMeterGridPowerKw`'s sign convention (negative = importing, positive = exporting), sourced from `DeviceTelemetry` instead. */
function deriveGridReadings(
  row: { meterActivePower: { toNumber(): number } | null } | null,
): { currentExport: ProductionReading; currentImport: ProductionReading } {
  if (!row || row.meterActivePower === null) {
    return {
      currentExport: UNAVAILABLE_NO_TELEMETRY,
      currentImport: UNAVAILABLE_NO_TELEMETRY,
    };
  }

  const kw = row.meterActivePower.toNumber();

  return {
    currentExport: kw > 0 ? { available: true, kw } : { available: true, kw: 0 },
    currentImport: kw < 0 ? { available: true, kw: Math.abs(kw) } : { available: true, kw: 0 },
  };
}

export async function getProductionPageData(
  organizationId: string,
  selectedDateParam: string | undefined,
): Promise<ProductionPageData> {
  const todayDateStr = formatDateInZone(new Date(), BULGARIA_TIMEZONE);
  const selectedDate =
    selectedDateParam && isValidDateString(selectedDateParam)
      ? selectedDateParam
      : todayDateStr;
  const isToday = selectedDate === todayDateStr;
  const referenceInstant = new Date(`${selectedDate}T12:00:00Z`);

  const { start: dayStart, end: dayEnd } = localDayBoundsUtc(
    referenceInstant,
    BULGARIA_TIMEZONE,
  );
  // Never show future data for "today" (the day is still in progress); a
  // past day already fully happened, so its whole day is real data.
  const seriesEnd = isToday ? new Date() : dayEnd;

  const plant = await prisma.plant.findFirst({
    where: {
      organizationId,
      vendor: "Huawei",
      stationCode: { not: null },
      plantCode: { not: null },
    },
    select: { id: true, plantCode: true, timezone: true, capacityKw: true },
  });

  // Read directly from the plant's own configuration — never hardcoded,
  // never derived from telemetry. `null` only when genuinely unconfigured.
  const installedCapacityKw = plant?.capacityKw
    ? Number(plant.capacityKw.toString())
    : null;

  // Category B — DeviceTelemetry only, needs a plant but never a live
  // FusionSolar connection. Computed unconditionally: historical telemetry
  // can exist (and should keep being shown) even if the live connection is
  // currently broken or was revoked.
  let settlementEnergySeries: SettlementEnergyPoint[] = [];
  let latestTelemetryAt: Date | null = null;

  if (plant) {
    const [series, latestTelemetryRow] = await Promise.all([
      getPlantSettlementEnergySeries(plant.id, dayStart, seriesEnd),
      getLatestTelemetry({ plantId: plant.id }),
    ]);

    settlementEnergySeries = series;
    latestTelemetryAt = latestTelemetryRow?.timestamp ?? null;
  }

  // Category A — "current" state, database-only (Database-First Telemetry
  // Architecture milestone). No live Huawei call, no FusionSolarConnection
  // lookup here at all — `getLatestInverterTelemetry`/`getLatestMeterTelemetry`
  // transparently ensure the connection is synchronized before returning.
  // Only ever computed for `isToday` — "current production" has no
  // meaning while browsing a historical day, independent of where the
  // value comes from.
  if (!plant || !isToday) {
    return {
      currentProduction: UNAVAILABLE_NO_TELEMETRY,
      currentExport: UNAVAILABLE_NO_TELEMETRY,
      currentImport: UNAVAILABLE_NO_TELEMETRY,
      configuredExportMode: UNAVAILABLE_NO_CONNECTION_MODE,
      configuredExportModeLabel: describeConfiguredExportMode(
        UNAVAILABLE_NO_CONNECTION_MODE,
      ),
      settlementEnergySeries,
      installedCapacityKw,
      latestTelemetryAt,
    };
  }

  const [inverterRows, meterRow] = await Promise.all([
    getLatestInverterTelemetry(plant.id),
    getLatestMeterTelemetry(plant.id),
  ]);

  const currentProduction = sumInverterProduction(inverterRows);
  const { currentExport, currentImport } = deriveGridReadings(meterRow);

  return {
    currentProduction,
    currentExport,
    currentImport,
    configuredExportMode: UNAVAILABLE_NO_CONNECTION_MODE,
    configuredExportModeLabel: describeConfiguredExportMode(
      UNAVAILABLE_NO_CONNECTION_MODE,
    ),
    settlementEnergySeries,
    installedCapacityKw,
    latestTelemetryAt,
  };
}
