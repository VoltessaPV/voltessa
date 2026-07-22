import { importDeviceTelemetry } from "@/lib/fusionsolar/import-device-telemetry";
import { importPlantDailyKpi } from "@/lib/fusionsolar/import-plant-daily-kpi";
import { localDayBoundsUtc } from "@/lib/market-price/timezone";
import { prisma } from "@/lib/prisma";

/**
 * Database-First Telemetry Architecture milestone. The single
 * synchronization boundary for the entire application — modeled directly
 * on `getValidFusionSolarAccessToken()`: every caller (the scheduler, the
 * manual Refresh action, the telemetry repository layer, any future admin
 * tool) asks "is this connection synchronized," never "how does
 * synchronization work." Nothing outside this file may call
 * `importDeviceTelemetry`/`importPlantDailyKpi` directly, and nothing
 * outside this file computes freshness, acquires a lease, or decides
 * whether Huawei gets contacted.
 *
 * Coordination boundary is `FusionSolarConnection`, not `Plant` or
 * `Organization` — this is where the actual shared, contended resources
 * live: the OAuth token and Huawei's own per-account rate limit are shared
 * across every plant under one connection, confirmed by
 * `@@unique([organizationId, provider])` and by
 * `getValidFusionSolarAccessToken` mutating the token by `connection.id`.
 * A connection-scoped sync already covers every plant beneath it in one
 * pass, exactly like today's scheduler already does — see
 * `runConnectionSync` below, moved here unchanged from the former
 * `bootstrap-device-telemetry.ts`.
 *
 * Concurrency is coordinated via a claim on the connection's own row (a
 * single conditional `UPDATE ... WHERE ...`), not an in-memory lock —
 * Vercel serverless functions are stateless and instance-isolated, so an
 * in-memory map cannot coordinate two concurrent requests landing on
 * different invocations. If another request already holds the lease, this
 * one does NOT poll or wait for it — it returns immediately and the caller
 * renders from whatever is already in the database; the in-flight sync's
 * own completion is what the *next* request will see.
 *
 * Primary acceptance criterion: a Huawei/network failure during a sync is
 * caught and logged here, never rethrown — callers must keep rendering
 * from the database even when Huawei is temporarily unavailable.
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Every plant this pipeline serves today is Bulgarian (see
 * `docs/CLIENT_REQUIREMENTS.md`'s MVP scope) — matches the Market chart's
 * own local-day convention. Not read from `Plant.timezone` since the
 * window is computed once per connection, before the per-plant loop.
 */
const BULGARIA_TIMEZONE = "Europe/Sofia";

/** "Yesterday + today" — the historical default this pipeline has always used. */
const DAYS_BACK = 1;

/**
 * How long a claimed lease is honored before another request may reclaim
 * it — must comfortably exceed how long a real sync (a handful of Huawei
 * calls per plant) takes, so a live sync is never preempted, but short
 * enough that a crashed/timed-out invocation doesn't strand the connection
 * for long.
 */
const SYNC_LEASE_MS = 2 * 60 * 1000;

/**
 * The single shared, explicitly-tunable freshness threshold — referenced
 * everywhere a caller decides "is this connection's telemetry fresh
 * enough," never duplicated as a literal. Approved architecture: the
 * scheduler now runs hourly (06:00-22:00) plus a 23:58 close, so this
 * constant is no longer coupled to the scheduler's own cadence — it is
 * specifically the login-triggered freshness threshold ("if the last
 * successful Huawei sync is older than 5 minutes, sync now"). The
 * scheduler goes through this exact same check as every other caller (no
 * special-cased `force`), so a scheduled run within 5 minutes of a
 * login-triggered sync is simply skipped as already fresh.
 */
export const FUSIONSOLAR_SYNC_FRESHNESS_MS = 5 * 60 * 1000;

/**
 * Start of the sync window: `DAYS_BACK` complete local calendar days
 * before today, plus today itself (partial, up to now). Re-derives the
 * target day's own true local midnight after the naive jump (not just the
 * naive instant) so a DST transition anywhere in the window can never
 * shift the boundary by an hour — same technique `localDayBoundsUtc`'s own
 * next-day derivation already uses.
 */
function computeSyncWindowStart(): Date {
  const { start: todayStart } = localDayBoundsUtc(new Date(), BULGARIA_TIMEZONE);
  const candidate = new Date(todayStart.getTime() - DAYS_BACK * ONE_DAY_MS);

  return localDayBoundsUtc(candidate, BULGARIA_TIMEZONE).start;
}

type ConnectionForSync = {
  id: string;
  organizationId: string;
  accessToken: string;
  refreshToken: string | null;
  tokenType: string | null;
  scope: string | null;
  expiresAt: Date | null;
};

type ConnectionSyncOutcome = {
  plantsProcessed: number;
  samplesFetched: number;
  samplesInserted: number;
  duplicatesSkipped: number;
  unmatchedSamples: number;
  dailyKpisUpserted: number;
  errors: Array<{ devTypeId: number; collectTime: number; reason: string }>;
  dailyKpiErrors: Array<{ stationCode: string; reason: string }>;
};

/**
 * The actual per-connection Huawei work — moved here unchanged from the
 * former `bootstrapDeviceTelemetry`'s per-connection loop body.
 * `importDeviceTelemetry`/`importPlantDailyKpi` are reused verbatim; no
 * Huawei-calling logic is reimplemented.
 */
async function runConnectionSync(
  connection: ConnectionForSync,
): Promise<ConnectionSyncOutcome> {
  const windowEnd = new Date();
  const windowStart = computeSyncWindowStart();

  const plants = await prisma.plant.findMany({
    where: { organizationId: connection.organizationId, vendor: "Huawei" },
    select: { id: true },
  });

  let plantsProcessed = 0;
  let samplesFetched = 0;
  let samplesInserted = 0;
  let duplicatesSkipped = 0;
  let unmatchedSamples = 0;
  const errors: ConnectionSyncOutcome["errors"] = [];

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
    errors.push(...plantResult.errors);
  }

  const dailyKpiResult = await importPlantDailyKpi(
    connection.organizationId,
    connection,
  );

  return {
    plantsProcessed,
    samplesFetched,
    samplesInserted,
    duplicatesSkipped,
    unmatchedSamples,
    errors,
    dailyKpisUpserted: dailyKpiResult.kpisUpserted,
    dailyKpiErrors: dailyKpiResult.errors,
  };
}

export type SynchronizeFusionSolarConnectionResult =
  | { status: "skipped_fresh" }
  | { status: "skipped_already_running" }
  | { status: "connection_not_found" }
  | ({ status: "synced" } & ConnectionSyncOutcome)
  | { status: "failed"; reason: string };

/**
 * The sole public entry point for Huawei telemetry synchronization. Every
 * caller in the application — the scheduler, the manual Refresh action,
 * the telemetry repository layer — calls this and only this.
 *
 * `force` is reserved for an explicit, human-initiated "synchronize now"
 * request (the Refresh action, or a deliberately-invoked engineering
 * diagnostic) — normal page rendering and the scheduler both call this
 * without `force`, going through the identical freshness gate.
 */
export async function synchronizeFusionSolarConnection(
  connectionId: string,
  options: { force?: boolean } = {},
): Promise<SynchronizeFusionSolarConnectionResult> {
  const force = options.force ?? false;

  if (!force) {
    const current = await prisma.fusionSolarConnection.findUnique({
      where: { id: connectionId },
      select: { telemetryLastSyncedAt: true },
    });

    if (!current) {
      return { status: "connection_not_found" };
    }

    if (
      current.telemetryLastSyncedAt &&
      Date.now() - current.telemetryLastSyncedAt.getTime() <
        FUSIONSOLAR_SYNC_FRESHNESS_MS
    ) {
      return { status: "skipped_fresh" };
    }
  }

  const claimedAt = new Date();
  const leaseExpiresAt = new Date(claimedAt.getTime() + SYNC_LEASE_MS);

  // Atomic conditional claim — a single UPDATE, not a read-then-write pair.
  // Correct under Vercel's stateless/multi-instance model: only one
  // concurrent caller can flip this row from IDLE/expired to RUNNING.
  const claim = await prisma.fusionSolarConnection.updateMany({
    where: {
      id: connectionId,
      OR: [
        { telemetrySyncStatus: "IDLE" },
        { telemetrySyncLeaseExpiresAt: { lt: claimedAt } },
      ],
    },
    data: {
      telemetrySyncStatus: "RUNNING",
      telemetrySyncStartedAt: claimedAt,
      telemetrySyncLeaseExpiresAt: leaseExpiresAt,
    },
  });

  if (claim.count === 0) {
    // Another request already holds the lease for this connection. Never
    // poll or wait for it — the caller renders from whatever is already
    // in the database; the next request will see the completed sync.
    return { status: "skipped_already_running" };
  }

  try {
    const connection = await prisma.fusionSolarConnection.findUnique({
      where: { id: connectionId },
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

    if (!connection) {
      return { status: "connection_not_found" };
    }

    const outcome = await runConnectionSync(connection);

    await prisma.fusionSolarConnection.update({
      where: { id: connectionId },
      data: { telemetryLastSyncedAt: new Date() },
    });

    console.log("[FusionSolar Telemetry Sync] Connection synced", {
      connectionId,
      force,
      ...outcome,
    });

    return { status: "synced", ...outcome };
  } catch (error) {
    // Never rethrow — a Huawei/network failure must degrade to "stale data
    // keeps rendering," never a broken page or a broken scheduler cycle.
    const reason = error instanceof Error ? error.message : "unknown_error";

    console.error("[FusionSolar Telemetry Sync] Connection sync failed", {
      connectionId,
      force,
      error,
    });

    return { status: "failed", reason };
  } finally {
    await prisma.fusionSolarConnection.update({
      where: { id: connectionId },
      data: { telemetrySyncStatus: "IDLE" },
    });
  }
}
