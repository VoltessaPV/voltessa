/**
 * Market page's FusionSolar/Huawei orchestration — completely independent
 * from `market-data.ts` (the ENTSO-E orchestration). Neither imports the
 * other; `page.tsx` calls both and composes the results. This keeps the
 * Market Price Provider and the FusionSolar integration decoupled, per
 * this milestone's architecture requirement.
 *
 * Read-only: nothing here ever writes to Huawei, changes an export limit,
 * or modifies plant configuration. It only reads real-time telemetry
 * (`get-plant-power-status.ts`) and the configured export-control mode
 * (`get-export-control-status.ts`), reusing both exactly as built for
 * earlier milestones — no new direct API calls are introduced here.
 */

import {
  describeConfiguredExportMode,
  getPlantConfiguredExportControlMode,
  type ConfiguredExportControlMode,
} from "@/lib/fusionsolar/get-export-control-status";
import { getPlantCurrentPowerStatus } from "@/lib/fusionsolar/get-plant-power-status";
import { prisma } from "@/lib/prisma";

export type ProductionReading =
  | { available: true; kw: number }
  | { available: false; reason: string };

export type TodaysProductionReading =
  | { available: true; mwh: number; collectedAtLabel: string }
  | { available: false; reason: string };

export type ProductionPageData = {
  currentProduction: ProductionReading;
  currentExport: ProductionReading;
  currentImport: ProductionReading;
  todaysProduction: TodaysProductionReading;
  configuredExportMode: ConfiguredExportControlMode;
  configuredExportModeLabel: { label: string; colorClass: string };
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
): Promise<ProductionPageData> {
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

  const plant = await prisma.plant.findFirst({
    where: {
      organizationId,
      vendor: "Huawei",
      stationCode: { not: null },
      plantCode: { not: null },
    },
    include: {
      telemetrySnapshots: {
        orderBy: { collectedAt: "desc" },
        take: 1,
      },
    },
  });

  if (!connection || !plant || !plant.plantCode) {
    return {
      currentProduction: UNAVAILABLE_NO_CONNECTION,
      currentExport: UNAVAILABLE_NO_CONNECTION,
      currentImport: UNAVAILABLE_NO_CONNECTION,
      todaysProduction: {
        available: false,
        reason: "no_fusionsolar_connection",
      },
      configuredExportMode: UNAVAILABLE_NO_CONNECTION_MODE,
      configuredExportModeLabel: describeConfiguredExportMode(
        UNAVAILABLE_NO_CONNECTION_MODE,
      ),
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

  const latestSnapshot = plant.telemetrySnapshots[0];
  const todaysProduction: TodaysProductionReading = latestSnapshot?.dayPower
    ? {
        available: true,
        mwh: Math.round((Number(latestSnapshot.dayPower.toString()) / 1000) * 100) / 100,
        collectedAtLabel: latestSnapshot.collectedAt.toLocaleString(),
      }
    : { available: false, reason: "no_telemetry_snapshot" };

  return {
    currentProduction: powerStatus.currentProduction,
    currentExport: powerStatus.currentExport,
    currentImport: powerStatus.currentImport,
    todaysProduction,
    configuredExportMode,
    configuredExportModeLabel: describeConfiguredExportMode(configuredExportMode),
  };
}
