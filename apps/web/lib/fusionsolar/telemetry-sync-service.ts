import { after } from "next/server";

import { importDeviceTelemetry } from "@/lib/fusionsolar/import-device-telemetry";
import { importPlantDailyKpi } from "@/lib/fusionsolar/import-plant-daily-kpi";
import { localDayBoundsUtc } from "@/lib/market-price/timezone";
import { prisma } from "@/lib/prisma";
import { recordImporterRun } from "@/lib/admin/importer-run";

const IMPORTER_TYPE = "huawei_telemetry_sync";

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
 * enough," never duplicated as a literal. Live Telemetry Synchronization
 * Redesign milestone: the scheduler runs every 15 minutes (06:00-22:00
 * Europe/Sofia - see `docs/infrastructure/scaleway-production.md`), and
 * every other caller (login-triggered sync, the manual Refresh action, and
 * now Dashboard/Market's own background recovery check) shares this exact
 * same 5-minute threshold and goes through this exact same check (no
 * special-cased `force` for any of them) - so a caller that runs within 5
 * minutes of any other real sync is simply skipped as already fresh,
 * regardless of which of these triggered it.
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
async function performFusionSolarConnectionSync(
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

/**
 * Platform Health & Operations Center milestone (Section 10, Import
 * Health). Thin wrapper around `performFusionSolarConnectionSync` — every
 * caller keeps calling `synchronizeFusionSolarConnection` exactly as
 * before, but every invocation (scheduled or on-demand) now also records
 * one `ImporterRun` row via the single shared write path
 * (`lib/admin/importer-run.ts`), without touching the delicate lease/claim
 * logic above at all. `organizationId` is resolved separately (a single
 * indexed lookup) since none of `SynchronizeFusionSolarConnectionResult`'s
 * branches carry it directly.
 */
export async function synchronizeFusionSolarConnection(
  connectionId: string,
  options: { force?: boolean } = {},
): Promise<SynchronizeFusionSolarConnectionResult> {
  const startedAt = new Date();
  const outcome = await performFusionSolarConnectionSync(connectionId, options);

  const connectionForLog = await prisma.fusionSolarConnection.findUnique({
    where: { id: connectionId },
    select: { organizationId: true },
  });

  const base = {
    importerType: IMPORTER_TYPE,
    organizationId: connectionForLog?.organizationId ?? null,
    connectionId,
    startedAt,
  };

  switch (outcome.status) {
    case "skipped_fresh":
    case "skipped_already_running":
    case "connection_not_found":
      await recordImporterRun({ ...base, status: "SKIPPED", details: { reason: outcome.status } });
      break;
    case "synced":
      await recordImporterRun({
        ...base,
        status: "SUCCESS",
        rowsImported: outcome.samplesInserted + outcome.dailyKpisUpserted,
        rowsSkipped: outcome.duplicatesSkipped,
        rowsFailed: outcome.errors.length + outcome.dailyKpiErrors.length,
        details: outcome,
      });
      break;
    case "failed":
      await recordImporterRun({ ...base, status: "FAILED", errorMessage: outcome.reason });
      break;
  }

  return outcome;
}

export type TelemetryFreshnessResult = "fresh" | "synced" | "failed" | "already_running";

export type EnsureTelemetryFreshOptions =
  | { mode: "blocking" }
  | { mode: "background"; onSettled?: (result: TelemetryFreshnessResult) => void };

/** Maps `synchronizeFusionSolarConnection`'s own outcome to the flat result `ensureTelemetryFresh` exposes - the one place that translation happens. */
function toFreshnessResult(outcome: SynchronizeFusionSolarConnectionResult): TelemetryFreshnessResult {
  switch (outcome.status) {
    case "skipped_fresh":
      return "fresh";
    case "synced":
      return "synced";
    case "skipped_already_running":
      return "already_running";
    case "connection_not_found":
    case "failed":
      return "failed";
  }
}

/**
 * The single place in the application that decides whether an
 * organization's FusionSolar telemetry needs synchronizing right now, and
 * how urgently. Every page that depends on telemetry freshness calls this
 * - and only this - never `synchronizeFusionSolarConnection` directly;
 * "is it fresh" and "is a sync already running" stay decided in exactly
 * one place (this function's own delegation to `synchronizeFusionSolarConnection`,
 * which already owns the freshness threshold and the sync lease - neither
 * is recomputed here).
 *
 * Deliberately returns a plain result instead of performing any Next.js
 * cache invalidation itself - revalidating `/dashboard`/`/market` is a UI
 * concern the caller decides, not a synchronization concern. The one
 * Next.js-specific primitive this function still owns is `after()` for
 * "background" mode, and that's a runtime-lifetime guarantee, not a UI
 * one: without it, a fire-and-forget sync can be killed when a serverless
 * function instance is recycled once the response has been sent.
 *
 * "blocking" (Dashboard/Market): awaits the real outcome and returns only
 * once genuinely done - these pages render telemetry and must never show
 * a mix of data from different sync cycles.
 *
 * "background" (Settings/Automations/Alerts/Plants): schedules the sync
 * via `after()` and returns immediately without blocking the caller's own
 * render. The real outcome is only knowable once that scheduled work
 * completes, by which point the original request has already finished -
 * `onSettled`, invoked from inside the same `after()` continuation, is the
 * only remaining way a caller can react to it (e.g. to revalidate
 * Dashboard/Market's cached entries so a later visit is already fresh).
 */
export async function ensureTelemetryFresh(
  organizationId: string,
  options: { mode: "blocking" },
): Promise<TelemetryFreshnessResult>;
export async function ensureTelemetryFresh(
  organizationId: string,
  options: { mode: "background"; onSettled?: (result: TelemetryFreshnessResult) => void },
): Promise<void>;
export async function ensureTelemetryFresh(
  organizationId: string,
  options: EnsureTelemetryFreshOptions,
): Promise<TelemetryFreshnessResult | void> {
  const connection = await prisma.fusionSolarConnection.findUnique({
    where: {
      organizationId_provider: { organizationId, provider: "HuaweiFusionSolar" },
    },
    select: { id: true },
  });

  if (!connection) {
    // Nothing to synchronize - not a failure, just nothing to do.
    if (options.mode === "blocking") {
      return "fresh";
    }
    return;
  }

  if (options.mode === "blocking") {
    const outcome = await synchronizeFusionSolarConnection(connection.id);
    return toFreshnessResult(outcome);
  }

  const connectionId = connection.id;
  const onSettled = options.onSettled;

  after(async () => {
    const outcome = await synchronizeFusionSolarConnection(connectionId);
    onSettled?.(toFreshnessResult(outcome));
  });
}
