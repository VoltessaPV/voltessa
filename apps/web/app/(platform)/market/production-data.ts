/**
 * Market page's production-side orchestration — completely independent
 * from `market-data.ts` (the ENTSO-E orchestration). Neither imports the
 * other; `page.tsx` calls both and composes the results. This keeps the
 * Market Price Provider and the telemetry/FusionSolar integration
 * decoupled, per this milestone's architecture requirement.
 *
 * Per the Telemetry Consumer Migration milestone (see ADR-007,
 * docs/research/telemetry-platform-foundation.md), reads are split into
 * two explicit categories:
 *
 * - **Category A — real-time operational state, still live Huawei reads**:
 *   `currentProduction`/`currentExport`/`currentImport`
 *   (`get-plant-power-status.ts`) and `configuredExportMode`
 *   (`get-export-control-status.ts`). These describe "right now" and have
 *   no historical equivalent to fall back to — kept exactly as built for
 *   earlier milestones, no new direct API calls introduced here.
 * - **Category B — historical/trend data, now DeviceTelemetry-only**:
 *   `settlementEnergySeries` comes from `lib/telemetry/energy-metrics.ts`,
 *   which only reads `DeviceTelemetry` — no Huawei call, no FusionSolar
 *   connection needed.
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
  getPlantConfiguredExportControlMode,
  type ConfiguredExportControlMode,
} from "@/lib/fusionsolar/get-export-control-status";
import { getPlantCurrentPowerStatus } from "@/lib/fusionsolar/get-plant-power-status";
import {
  formatDateInZone,
  localDayBoundsUtc,
} from "@/lib/market-price/timezone";
import { prisma } from "@/lib/prisma";
import {
  getPlantSettlementEnergySeries,
  type SettlementEnergyPoint,
} from "@/lib/telemetry/energy-metrics";
import { getLatestTelemetry } from "@/lib/telemetry/queries";

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

const UNAVAILABLE_NO_CONNECTION: ProductionReading = {
  available: false,
  reason: "no_fusionsolar_connection",
};

const UNAVAILABLE_NO_CONNECTION_MODE: ConfiguredExportControlMode = {
  available: false,
  reason: "configuration_endpoint_failed",
};

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

  // Category A — real-time operational state, still a live Huawei read.
  // Needs a connection and a plantCode; degrades to an explicit
  // "unavailable" state rather than ever falling back to telemetry (a
  // stale 5-minute-old sample is not "current state"). Only ever fetched
  // for today — a past day has no "current" reading to show.
  const connection = isToday
    ? await prisma.fusionSolarConnection.findUnique({
        where: {
          organizationId_provider: {
            organizationId,
            provider: "HuaweiFusionSolar",
          },
        },
        select: {
          id: true,
          accessToken: true,
          refreshToken: true,
          tokenType: true,
          scope: true,
          expiresAt: true,
        },
      })
    : null;

  if (!connection || !plant || !plant.plantCode) {
    return {
      currentProduction: UNAVAILABLE_NO_CONNECTION,
      currentExport: UNAVAILABLE_NO_CONNECTION,
      currentImport: UNAVAILABLE_NO_CONNECTION,
      configuredExportMode: UNAVAILABLE_NO_CONNECTION_MODE,
      configuredExportModeLabel: describeConfiguredExportMode(
        UNAVAILABLE_NO_CONNECTION_MODE,
      ),
      settlementEnergySeries,
      installedCapacityKw,
      latestTelemetryAt,
    };
  }

  const [inverters, meters] = await Promise.all([
    prisma.device.findMany({
      where: { plantId: plant.id, devTypeId: 1 },
      select: { huaweiDeviceId: true },
    }),
    prisma.device.findMany({
      where: { plantId: plant.id, devTypeId: 47 },
      select: { huaweiDeviceId: true },
    }),
  ]);

  let powerStatus;

  try {
    powerStatus = await getPlantCurrentPowerStatus(connection, {
      inverters,
      meters,
    });
  } catch {
    // Never let an unexpected FusionSolar error break the page — degrade
    // to an explicit unavailable state, matching the Dashboard's
    // established pattern for this exact integration.
    powerStatus = {
      currentProduction: {
        available: false as const,
        reason: "unexpected_error",
      },
      currentExport: { available: false as const, reason: "unexpected_error" },
      currentImport: { available: false as const, reason: "unexpected_error" },
    };
  }

  let configuredExportMode: ConfiguredExportControlMode;

  try {
    configuredExportMode = await getPlantConfiguredExportControlMode(
      connection,
      plant.plantCode,
    );
  } catch {
    configuredExportMode = UNAVAILABLE_NO_CONNECTION_MODE;
  }

  return {
    currentProduction: powerStatus.currentProduction,
    currentExport: powerStatus.currentExport,
    currentImport: powerStatus.currentImport,
    configuredExportMode,
    configuredExportModeLabel: describeConfiguredExportMode(configuredExportMode),
    settlementEnergySeries,
    installedCapacityKw,
    latestTelemetryAt,
  };
}
