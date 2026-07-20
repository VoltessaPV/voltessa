import { importDeviceTelemetry } from "@/lib/fusionsolar/import-device-telemetry";
import { importPlantDailyKpi } from "@/lib/fusionsolar/import-plant-daily-kpi";
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
  /** `PlantDailyKpi` rows written this cycle (Telemetry Architecture Finalization milestone, ADR-010) — Huawei's own daily Produced/Consumed counters, alongside the device-level telemetry this bootstrap already wrote. */
  dailyKpisUpserted: number;
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
  dailyKpiErrors: Array<{ organizationId: string; stationCode: string; reason: string }>;
  failures: Array<{ organizationId: string; reason: string }>;
};

/**
 * Bootstrap/backfill: imports `daysBack` complete local (Europe/Sofia)
 * calendar days plus today's 5-minute device telemetry, for every
 * organization with a FusionSolar connection. `daysBack` defaults to `1`
 * (yesterday + today — the original bootstrap window). This is the one
 * production scheduler for Huawei ingestion (ADR-009's
 * `voltessa-telemetry-ingestion.service`, a Scaleway systemd timer, calls
 * this route every 5 minutes) — not the manual/one-off tool the name might
 * suggest. Safe to re-run with any `daysBack` value, including a smaller or
 * larger one than a previous call: the underlying device-telemetry importer
 * is idempotent (`(deviceId, timestamp, resolution)` unique constraint,
 * `skipDuplicates: true`).
 *
 * Telemetry Architecture Finalization milestone (ADR-010): every cycle also
 * fetches and upserts Huawei's station-level daily KPIs
 * (`import-plant-daily-kpi.ts` -> `PlantDailyKpi`) — the authoritative
 * source for Produced/Consumed Today. This is an extension of the existing
 * ingestion pipeline, not a second scheduler: exactly one Scaleway timer,
 * one route, one execution per cycle, matching ADR-009's "exactly one
 * production scheduler" decision.
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
  let dailyKpisUpserted = 0;

  const perPlant: DeviceTelemetryBootstrapResult["perPlant"] = [];
  const dailyKpiErrors: DeviceTelemetryBootstrapResult["dailyKpiErrors"] = [];
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

        console.log("[FusionSolar Device Telemetry Bootstrap] Plant processed", {
          organizationId: connection.organizationId,
          plantId: plant.id,
          samplesFetched: plantResult.samplesFetched,
          samplesInserted: plantResult.samplesInserted,
          duplicatesSkipped: plantResult.duplicatesSkipped,
          unmatchedSamples: plantResult.unmatchedSamples,
          errors: plantResult.errors,
        });

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

      const dailyKpiResult = await importPlantDailyKpi(
        connection.organizationId,
        connection,
      );

      dailyKpisUpserted += dailyKpiResult.kpisUpserted;

      for (const error of dailyKpiResult.errors) {
        dailyKpiErrors.push({
          organizationId: connection.organizationId,
          stationCode: error.stationCode,
          reason: error.reason,
        });
      }

      console.log("[FusionSolar Plant Daily KPI] Organization processed", {
        organizationId: connection.organizationId,
        plantsRequested: dailyKpiResult.plantsRequested,
        kpisUpserted: dailyKpiResult.kpisUpserted,
        errors: dailyKpiResult.errors,
      });

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
    dailyKpisUpserted,
    perPlant,
    dailyKpiErrors,
    failures,
  };
}
