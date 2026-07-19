import { importDeviceTelemetry } from "@/lib/fusionsolar/import-device-telemetry";
import { localDayBoundsUtc } from "@/lib/market-price/timezone";
import { prisma } from "@/lib/prisma";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Every plant this bootstrap serves today is Bulgarian (see
 * `docs/CLIENT_REQUIREMENTS.md`'s MVP scope); "N complete local days" is
 * therefore always anchored to Europe/Sofia, matching the Market chart's
 * own local-day convention (see `market-data.ts`). Not read from
 * `Plant.timezone` here because the window is computed once for every
 * organization/plant in a single pass, before any per-plant loop.
 */
const BULGARIA_TIMEZONE = "Europe/Sofia";

/**
 * Start of the backfill window: `daysBack` complete local calendar days
 * before today, plus today itself (partial, up to now). `daysBack = 1`
 * (the historical default) reproduces the original "yesterday + today"
 * one-day window exactly. Re-derives the target day's own true local
 * midnight after the naive `daysBack * 24h` jump (not just the naive
 * instant) so a DST transition anywhere in the window can never shift the
 * boundary by an hour — same technique as `localDayBoundsUtc`'s own
 * next-day derivation.
 */
function computeBackfillWindowStart(daysBack: number): Date {
  const { start: todayStart } = localDayBoundsUtc(new Date(), BULGARIA_TIMEZONE);
  const candidate = new Date(todayStart.getTime() - daysBack * ONE_DAY_MS);

  return localDayBoundsUtc(candidate, BULGARIA_TIMEZONE).start;
}

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
 * Bootstrap/backfill: imports `daysBack` complete local (Europe/Sofia)
 * calendar days plus today's 5-minute device telemetry, for every
 * organization with a FusionSolar connection. `daysBack` defaults to `1`
 * (yesterday + today — the original bootstrap window). Manual/
 * externally-triggered execution only — not wired to any cron/scheduler.
 * Safe to re-run with any `daysBack` value, including a smaller or larger
 * one than a previous call: the underlying importer is idempotent
 * (`(deviceId, timestamp, resolution)` unique constraint,
 * `skipDuplicates: true`).
 */
export async function bootstrapDeviceTelemetry(
  daysBack = 1,
): Promise<DeviceTelemetryBootstrapResult> {
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

  const windowEnd = new Date();
  const windowStart = computeBackfillWindowStart(daysBack);

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
