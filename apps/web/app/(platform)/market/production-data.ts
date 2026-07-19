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
 *   `todaysProduction`, `peakExport`, `exportedEnergyToday`,
 *   `telemetryInsights`, and `settlementEnergySeries` all come from
 *   `lib/telemetry/energy-metrics.ts`, which only reads `DeviceTelemetry`
 *   — no Huawei call, no FusionSolar connection needed for any of these.
 *   Imported energy is deliberately NOT exposed here (Market Dashboard UX
 *   Polish milestone): Market is about revenue from exported electricity,
 *   never imported energy — that stays a Dashboard-only concern
 *   (`dashboard/page.tsx` computes its own via `computePlantEnergyMetrics`
 *   directly, untouched by this module).
 *
 * Read-only either way: nothing here ever writes to Huawei, changes an
 * export limit, or modifies plant configuration.
 *
 * ## Date-awareness (Historical Backfill + Timeline Alignment /
 * Mathematical Correctness milestone)
 *
 * Every Category B value here used to be computed unconditionally for
 * "right now" — regardless of which day the Market toolbar had selected —
 * and `page.tsx` additionally hid the chart's telemetry overlay entirely
 * whenever a past day was selected. Both were root causes of "historical
 * telemetry missing": once DeviceTelemetry actually contained a week of
 * real backfilled data, there was no code path left that would ever
 * display it. This module now computes the exact same
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
  computePlantEnergyMetrics,
  getPlantSettlementEnergySeries,
  type SettlementEnergyPoint,
} from "@/lib/telemetry/energy-metrics";

/** Same Sofia local-day convention `market-data.ts` uses for the Market page's displayed day — duplicated intentionally, see this module's doc comment. */
const BULGARIA_TIMEZONE = "Europe/Sofia";

function isValidDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export type ProductionReading =
  | { available: true; kw: number }
  | { available: false; reason: string };

export type TodaysProductionReading =
  | { available: true; kwh: number; sampleCount: number }
  | { available: false; reason: string };

/** Peak *meter export* power (not inverter production power) — see energy-metrics.ts's `peakExport` doc comment for why this distinction matters and how it was found. */
export type PeakExportReading =
  | { available: true; kw: number; atLabel: string }
  | { available: false; reason: string };

/** Structurally identical to `market-data.ts`'s `MarketInsight` (never imported from there, to preserve this module's independence — see the module doc comment) so `page.tsx` can freely concatenate both arrays. */
export type ProductionInsight = {
  text: string;
  tone: "neutral" | "positive" | "warning";
};

export type ProductionPageData = {
  currentProduction: ProductionReading;
  currentExport: ProductionReading;
  currentImport: ProductionReading;
  todaysProduction: TodaysProductionReading;
  peakExportToday: PeakExportReading;
  exportedEnergyToday: TodaysProductionReading;
  configuredExportMode: ConfiguredExportControlMode;
  configuredExportModeLabel: { label: string; colorClass: string };
  telemetryInsights: ProductionInsight[];
  /**
   * Real exported/imported energy per 15-minute settlement interval for
   * the *selected* day (the whole day if it's a past day; today-so-far if
   * it's today) — derived from the meter's real cumulative energy
   * counters, never from power integration (see energy-metrics.ts's doc
   * comment). Aligned to the exact same Europe/Sofia 15-minute grid as
   * `market-data.ts`'s price series, so the Market chart can merge them by
   * timestamp with no resampling. Empty only when no plant/telemetry
   * exists for this organization.
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
};

const UNAVAILABLE_NO_CONNECTION: ProductionReading = {
  available: false,
  reason: "no_fusionsolar_connection",
};

const UNAVAILABLE_NO_CONNECTION_MODE: ConfiguredExportControlMode = {
  available: false,
  reason: "configuration_endpoint_failed",
};

const UNAVAILABLE_NO_PLANT: TodaysProductionReading = {
  available: false,
  reason: "no_plant",
};

const UNAVAILABLE_NO_PLANT_PEAK: PeakExportReading = {
  available: false,
  reason: "no_plant",
};

function sofiaTimeLabel(date: Date): string {
  return date.toLocaleTimeString("en-GB", {
    timeZone: "Europe/Sofia",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Plain, factual observations over real DeviceTelemetry — mirrors
 * `market-data.ts`'s `buildInsights` in spirit (statistics anyone could
 * recompute from the same data), but sourced entirely from telemetry, not
 * price. `available: false` fields are simply omitted rather than shown
 * as a fabricated zero. Day-neutral wording ("Production: X kWh" rather
 * than always "Today's production") since these now describe whichever
 * day the Market toolbar has selected, not always today.
 *
 * Market Dashboard UX Polish milestone: deliberately production/peak/
 * exported energy only — no imported energy (Market is about revenue from
 * exported electricity, not imports) and no instantaneous current-export/
 * import power reading (Market shows energy, not power; power stays a
 * Dashboard concern — see ADR-007/the Mathematical Correctness milestone).
 */
function buildTelemetryInsights(params: {
  isToday: boolean;
  todaysProduction: TodaysProductionReading;
  peakExportToday: PeakExportReading;
  exportedEnergyToday: TodaysProductionReading;
}): ProductionInsight[] {
  const insights: ProductionInsight[] = [];
  const dayPrefix = params.isToday ? "Today's" : "Selected day's";

  if (params.todaysProduction.available) {
    insights.push({
      text: `${dayPrefix} production: ${params.todaysProduction.kwh} kWh`,
      tone: "neutral",
    });
  }

  if (params.peakExportToday.available) {
    insights.push({
      text: `Maximum export today: ${params.peakExportToday.kw} kW at ${params.peakExportToday.atLabel}`,
      tone: "positive",
    });
  }

  if (params.exportedEnergyToday.available) {
    insights.push({
      text: `Exported energy: ${params.exportedEnergyToday.kwh} kWh`,
      tone: "neutral",
    });
  }

  return insights;
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
  let todaysProduction: TodaysProductionReading = UNAVAILABLE_NO_PLANT;
  let peakExportToday: PeakExportReading = UNAVAILABLE_NO_PLANT_PEAK;
  let exportedEnergyToday: TodaysProductionReading = UNAVAILABLE_NO_PLANT;
  let settlementEnergySeries: SettlementEnergyPoint[] = [];

  if (plant) {
    const [metrics, series] = await Promise.all([
      computePlantEnergyMetrics(plant.id, dayStart, seriesEnd),
      getPlantSettlementEnergySeries(plant.id, dayStart, seriesEnd),
    ]);

    settlementEnergySeries = series;

    todaysProduction = metrics.available
      ? { available: true, kwh: metrics.producedKwh, sampleCount: metrics.sampleCount }
      : { available: false, reason: "no_telemetry" };

    peakExportToday = metrics.available && metrics.peakExport
      ? {
          available: true,
          kw: metrics.peakExport.kw,
          atLabel: sofiaTimeLabel(metrics.peakExport.timestamp),
        }
      : { available: false, reason: "no_telemetry" };

    exportedEnergyToday = metrics.available
      ? { available: true, kwh: metrics.exportedKwh, sampleCount: metrics.sampleCount }
      : { available: false, reason: "no_telemetry" };
  }

  const telemetryInsights = buildTelemetryInsights({
    isToday,
    todaysProduction,
    peakExportToday,
    exportedEnergyToday,
  });

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
      todaysProduction,
      peakExportToday,
      exportedEnergyToday,
      configuredExportMode: UNAVAILABLE_NO_CONNECTION_MODE,
      configuredExportModeLabel: describeConfiguredExportMode(
        UNAVAILABLE_NO_CONNECTION_MODE,
      ),
      telemetryInsights,
      settlementEnergySeries,
      installedCapacityKw,
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
    todaysProduction,
    peakExportToday,
    exportedEnergyToday,
    configuredExportMode,
    configuredExportModeLabel: describeConfiguredExportMode(configuredExportMode),
    telemetryInsights,
    settlementEnergySeries,
    installedCapacityKw,
  };
}
