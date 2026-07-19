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
 *   `todaysProduction`, `peakProduction`, `exportedEnergyToday`,
 *   `importedEnergyToday`, and `telemetryInsights` all come from
 *   `lib/telemetry/energy-metrics.ts`, which only reads `DeviceTelemetry`
 *   — no Huawei call, no FusionSolar connection needed for any of these.
 *
 * Read-only either way: nothing here ever writes to Huawei, changes an
 * export limit, or modifies plant configuration.
 */

import {
  describeConfiguredExportMode,
  getPlantConfiguredExportControlMode,
  type ConfiguredExportControlMode,
} from "@/lib/fusionsolar/get-export-control-status";
import { getPlantCurrentPowerStatus } from "@/lib/fusionsolar/get-plant-power-status";
import { localDayBoundsUtc } from "@/lib/market-price/timezone";
import { prisma } from "@/lib/prisma";
import {
  computeEnergyMetricsFromSeries,
  getPlantTelemetrySeries,
  type PlantTelemetrySeriesPoint,
} from "@/lib/telemetry/energy-metrics";
import { getLatestMeterTelemetry } from "@/lib/telemetry/queries";

export type ProductionReading =
  | { available: true; kw: number }
  | { available: false; reason: string };

export type TodaysProductionReading =
  | { available: true; kwh: number; sampleCount: number }
  | { available: false; reason: string };

export type PeakProductionReading =
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
  peakProductionToday: PeakProductionReading;
  exportedEnergyToday: TodaysProductionReading;
  importedEnergyToday: TodaysProductionReading;
  configuredExportMode: ConfiguredExportControlMode;
  configuredExportModeLabel: { label: string; colorClass: string };
  telemetryInsights: ProductionInsight[];
  /** Real, today-so-far production/export series for the Market chart overlay — empty when no plant/telemetry exists, never fabricated. */
  telemetrySeries: PlantTelemetrySeriesPoint[];
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

const UNAVAILABLE_NO_PLANT_PEAK: PeakProductionReading = {
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
 * as a fabricated zero.
 */
function buildTelemetryInsights(params: {
  todaysProduction: TodaysProductionReading;
  peakProductionToday: PeakProductionReading;
  exportedEnergyToday: TodaysProductionReading;
  importedEnergyToday: TodaysProductionReading;
  latestMeterKw: number | null;
}): ProductionInsight[] {
  const insights: ProductionInsight[] = [];

  if (params.todaysProduction.available) {
    insights.push({
      text: `Today's production: ${params.todaysProduction.kwh} kWh`,
      tone: "neutral",
    });
  }

  if (params.latestMeterKw !== null) {
    insights.push(
      params.latestMeterKw > 0
        ? {
            text: `Current export: ${Math.round(params.latestMeterKw * 100) / 100} kW`,
            tone: "positive",
          }
        : params.latestMeterKw < 0
          ? {
              text: `Current import: ${Math.round(Math.abs(params.latestMeterKw) * 100) / 100} kW`,
              tone: "neutral",
            }
          : { text: "Current grid exchange: 0 kW", tone: "neutral" },
    );
  }

  if (params.peakProductionToday.available) {
    insights.push({
      text: `Peak production today: ${params.peakProductionToday.kw} kW at ${params.peakProductionToday.atLabel}`,
      tone: "positive",
    });
  }

  if (params.exportedEnergyToday.available) {
    insights.push({
      text: `Exported energy today: ${params.exportedEnergyToday.kwh} kWh`,
      tone: "neutral",
    });
  }

  if (params.importedEnergyToday.available) {
    insights.push({
      text: `Imported energy today: ${params.importedEnergyToday.kwh} kWh`,
      tone: "neutral",
    });
  }

  return insights;
}

export async function getProductionPageData(
  organizationId: string,
): Promise<ProductionPageData> {
  const plant = await prisma.plant.findFirst({
    where: {
      organizationId,
      vendor: "Huawei",
      stationCode: { not: null },
      plantCode: { not: null },
    },
    select: { id: true, plantCode: true, timezone: true },
  });

  // Category B — DeviceTelemetry only, needs a plant but never a live
  // FusionSolar connection. Computed unconditionally: historical telemetry
  // can exist (and should keep being shown) even if the live connection is
  // currently broken or was revoked.
  let todaysProduction: TodaysProductionReading = UNAVAILABLE_NO_PLANT;
  let peakProductionToday: PeakProductionReading = UNAVAILABLE_NO_PLANT_PEAK;
  let exportedEnergyToday: TodaysProductionReading = UNAVAILABLE_NO_PLANT;
  let importedEnergyToday: TodaysProductionReading = UNAVAILABLE_NO_PLANT;
  let latestMeterKw: number | null = null;
  let telemetrySeries: PlantTelemetrySeriesPoint[] = [];

  if (plant) {
    const { start: dayStart } = localDayBoundsUtc(new Date(), plant.timezone);
    const [series, latestMeter] = await Promise.all([
      getPlantTelemetrySeries(plant.id, dayStart, new Date()),
      getLatestMeterTelemetry(plant.id),
    ]);

    telemetrySeries = series;
    const metrics = computeEnergyMetricsFromSeries(series);

    todaysProduction = metrics.available
      ? { available: true, kwh: metrics.producedKwh, sampleCount: metrics.sampleCount }
      : { available: false, reason: "no_telemetry" };

    peakProductionToday = metrics.available && metrics.peakProduction
      ? {
          available: true,
          kw: metrics.peakProduction.kw,
          atLabel: sofiaTimeLabel(metrics.peakProduction.timestamp),
        }
      : { available: false, reason: "no_telemetry" };

    exportedEnergyToday = metrics.available
      ? { available: true, kwh: metrics.exportedKwh, sampleCount: metrics.sampleCount }
      : { available: false, reason: "no_telemetry" };

    importedEnergyToday = metrics.available
      ? { available: true, kwh: metrics.importedKwh, sampleCount: metrics.sampleCount }
      : { available: false, reason: "no_telemetry" };

    latestMeterKw =
      latestMeter?.meterActivePower !== null &&
      latestMeter?.meterActivePower !== undefined
        ? Number(latestMeter.meterActivePower)
        : null;
  }

  const telemetryInsights = buildTelemetryInsights({
    todaysProduction,
    peakProductionToday,
    exportedEnergyToday,
    importedEnergyToday,
    latestMeterKw,
  });

  // Category A — real-time operational state, still a live Huawei read.
  // Needs a connection and a plantCode; degrades to an explicit
  // "unavailable" state rather than ever falling back to telemetry (a
  // stale 5-minute-old sample is not "current state").
  const connection = await prisma.fusionSolarConnection.findUnique({
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
  });

  if (!connection || !plant || !plant.plantCode) {
    return {
      currentProduction: UNAVAILABLE_NO_CONNECTION,
      currentExport: UNAVAILABLE_NO_CONNECTION,
      currentImport: UNAVAILABLE_NO_CONNECTION,
      todaysProduction,
      peakProductionToday,
      exportedEnergyToday,
      importedEnergyToday,
      configuredExportMode: UNAVAILABLE_NO_CONNECTION_MODE,
      configuredExportModeLabel: describeConfiguredExportMode(
        UNAVAILABLE_NO_CONNECTION_MODE,
      ),
      telemetryInsights,
      telemetrySeries,
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
    peakProductionToday,
    exportedEnergyToday,
    importedEnergyToday,
    configuredExportMode,
    configuredExportModeLabel: describeConfiguredExportMode(configuredExportMode),
    telemetryInsights,
    telemetrySeries,
  };
}
