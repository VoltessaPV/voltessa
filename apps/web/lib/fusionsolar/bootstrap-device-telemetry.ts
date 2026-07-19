import { importDeviceTelemetry } from "@/lib/fusionsolar/import-device-telemetry";
import { prisma } from "@/lib/prisma";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export type DeviceTelemetryBootstrapResult = {
  organizationsProcessed: number;
  organizationsSucceeded: number;
  organizationsFailed: number;
  plantsProcessed: number;
  samplesFetched: number;
  samplesInserted: number;
  duplicatesSkipped: number;
  unmatchedSamples: number;
  perPlant: Array<{
    organizationId: string;
    plantId: string;
    devicesRequested: number;
    samplesFetched: number;
    samplesInserted: number;
    duplicatesSkipped: number;
    unmatchedSamples: number;
    errors: Array<{ devTypeId: number; collectTime: number; reason: string }>;
  }>;
  failures: Array<{ organizationId: string; reason: string }>;
};

/**
 * One-off bootstrap: imports only today and yesterday's 5-minute device
 * telemetry for every organization with a FusionSolar connection. Manual
 * execution only — not wired to any cron/scheduler. Safe to re-run: the
 * underlying importer is idempotent.
 */
export async function bootstrapDeviceTelemetry(): Promise<DeviceTelemetryBootstrapResult> {
  const connections = await prisma.fusionSolarConnection.findMany({
    where: { provider: "HuaweiFusionSolar" },
    select: {
      id: true,
      organizationId: true,
      accessToken: true,
      refreshToken: true,
      tokenType: true,
      scope: true,
      expiresAt: true,
    },
  });

  const now = new Date();
  const windowStart = new Date(now.getTime() - ONE_DAY_MS);
  const windowEnd = now;

  let organizationsSucceeded = 0;
  let plantsProcessed = 0;
  let samplesFetched = 0;
  let samplesInserted = 0;
  let duplicatesSkipped = 0;
  let unmatchedSamples = 0;

  const perPlant: DeviceTelemetryBootstrapResult["perPlant"] = [];
  const failures: DeviceTelemetryBootstrapResult["failures"] = [];

  for (const connection of connections) {
    try {
      const plants = await prisma.plant.findMany({
        where: { organizationId: connection.organizationId, vendor: "Huawei" },
        select: { id: true },
      });

      for (const plant of plants) {
        const plantResult = await importDeviceTelemetry({
          connection,
          organizationId: connection.organizationId,
          plantId: plant.id,
          windowStart,
          windowEnd,
        });

        plantsProcessed += 1;
        samplesFetched += plantResult.samplesFetched;
        samplesInserted += plantResult.samplesInserted;
        duplicatesSkipped += plantResult.duplicatesSkipped;
        unmatchedSamples += plantResult.unmatchedSamples;

        perPlant.push({
          organizationId: connection.organizationId,
          plantId: plant.id,
          devicesRequested: plantResult.devicesRequested,
          samplesFetched: plantResult.samplesFetched,
          samplesInserted: plantResult.samplesInserted,
          duplicatesSkipped: plantResult.duplicatesSkipped,
          unmatchedSamples: plantResult.unmatchedSamples,
          errors: plantResult.errors,
        });
      }

      organizationsSucceeded += 1;
    } catch (error) {
      failures.push({
        organizationId: connection.organizationId,
        reason: error instanceof Error ? error.message : "unknown_error",
      });

      console.error("[FusionSolar Device Telemetry Bootstrap] Organization failed", {
        organizationId: connection.organizationId,
        error,
      });
    }
  }

  return {
    organizationsProcessed: connections.length,
    organizationsSucceeded,
    organizationsFailed: failures.length,
    plantsProcessed,
    samplesFetched,
    samplesInserted,
    duplicatesSkipped,
    unmatchedSamples,
    perPlant,
    failures,
  };
}
