import { prisma } from "@/lib/prisma";

import type { ExportMode } from "./export-decision";

/**
 * Failure-safe execution-lock TTL (Atlanta Automation incident, 05-06 Sep
 * 2026). `finally`-based release is bypassed when the serverless function
 * is killed by Vercel's `maxDuration` ceiling or an OOM/eviction, so
 * `isRunning` can be left `true` forever — it was, for 48h+, which silently
 * disabled all Atlanta automation. This TTL is the ONLY protection against
 * that: a lock older than the TTL is treated as abandoned and can be
 * atomically reclaimed by the next cycle.
 *
 * 15 minutes, chosen conservatively from the REAL Atlanta browser-automation
 * characteristics, not an arbitrary short value:
 *   - The calling route's own Vercel `maxDuration` is 120s
 *     (`apps/web/vercel.json`), so a genuine, still-attached run cannot hold
 *     the lock past ~2 min before its process is gone.
 *   - Even a DETACHED Automation Service browser run (the Playwright process
 *     on the Scaleway VM keeps going after the caller dies) has a hard code
 *     ceiling near ~12 min: 3 dongles x (`waitForSaveConfirmation` 120s +
 *     `expandPlant` 60s + `openDeviceConfiguration` 30s + navigation) — see
 *     `automation/src/fusionSolar/navigation.ts`. Fast, healthy mode-change
 *     runs were observed at 78-83s (production `SchedulerRun` history).
 *   - 15 min > that ~12-min worst case, so we effectively never reclaim
 *     while any real operation (even an orphaned one) could still be writing
 *     to FusionSolar, yet a truly stuck lock self-heals at the very next
 *     15-minute cycle instead of persisting for hours or days.
 *   - It is exactly one scheduler cadence (`OnCalendar=*:0/15`): "still
 *     locked a full cycle later, and the process that took it died 13 min
 *     ago" is the definition of stuck here.
 */
export const EXECUTION_LOCK_TTL_MS = 15 * 60 * 1000;

/**
 * Failure-safe reconciliation-lock TTL. Reconciliation's browser path is
 * READ-ONLY (Read Status only — no Save, no hardware-relay wait) and was
 * observed at 30-52s over 30 days of production runs, with a theoretical
 * worst case near ~6 min. 10 minutes is ~10x the observed maximum and
 * comfortably above the ceiling, while being far below the 24h
 * reconciliation cadence so a stuck reconciliation lock always self-heals
 * long before the next scheduled run. An over-eager reclaim here has no
 * plant-safety consequence (reconciliation issues no command) but 10 min
 * stays conservative regardless.
 */
export const RECONCILIATION_LOCK_TTL_MS = 10 * 60 * 1000;

/**
 * Result of trying to acquire a persisted lock. `reclaimedStaleLock: true`
 * means the previous holder never released it (almost always a function
 * timeout/crash before cleanup) and this call atomically took it over — the
 * caller is expected to make that fact observable (see
 * `recordStaleExecutionLockReclaim` in the 15-minute scheduler).
 */
export type LockAcquisition =
  | { acquired: false }
  | { acquired: true; reclaimedStaleLock: false }
  | {
      acquired: true;
      reclaimedStaleLock: true;
      /** When the abandoned lock had been held since. */
      heldSince: Date;
      /** How long the abandoned lock had been held, in ms. */
      staleLockAgeMs: number;
    };

/**
 * The four atomic persisted-lock primitives, injectable so the
 * acquire/reclaim DECISION LOGIC (single-winner under contention) is
 * unit-testable against an in-memory store that models Postgres's atomic
 * conditional UPDATE, with no live database. Production binds these to
 * Prisma, where each call is one atomic SQL statement:
 *   - `claimIfFree`     -> `UPDATE ... SET running=true, lockedAt=now WHERE NOT running`
 *   - `reclaimIfStale`  -> `UPDATE ... SET lockedAt=now WHERE running AND lockedAt < staleBefore`
 * Under `READ COMMITTED`, a concurrent `UPDATE` that blocks on the row lock
 * re-evaluates its `WHERE` against the committed post-update row, so exactly
 * one caller ever gets `count === 1`.
 */
export type PersistedLockPrimitives = {
  ensureRow(organizationId: string): Promise<void>;
  /** Atomic CAS. Rows affected: 0 or 1. */
  claimIfFree(organizationId: string, now: Date): Promise<number>;
  /** Atomic CAS. Rows affected: 0 or 1. */
  reclaimIfStale(organizationId: string, now: Date, staleBefore: Date): Promise<number>;
  /** Non-CAS read — for classification/observability only, never the basis of the acquire decision. */
  read(organizationId: string): Promise<{ running: boolean; lockedAt: Date | null } | null>;
  release(organizationId: string): Promise<void>;
};

/**
 * Generic failure-safe lock acquire. Fresh lock -> taken. Held-and-recent
 * -> denied (a real run is in progress). Held-but-older-than-`ttlMs` ->
 * atomically reclaimed, with exactly one winner among concurrent callers
 * (the `reclaimIfStale` CAS is what guarantees that — the `read` above it
 * only classifies). Never relies on `finally`/cleanup; the TTL is
 * specifically the protection against a process dying before it can
 * release.
 */
export async function acquirePersistedLock(
  primitives: PersistedLockPrimitives,
  organizationId: string,
  ttlMs: number,
  now: Date = new Date(),
): Promise<LockAcquisition> {
  await primitives.ensureRow(organizationId);

  if ((await primitives.claimIfFree(organizationId, now)) === 1) {
    return { acquired: true, reclaimedStaleLock: false };
  }

  // The lock is held. Classify it — this read is NOT the compare-and-set;
  // the `reclaimIfStale` CAS below is.
  const staleBefore = new Date(now.getTime() - ttlMs);
  const held = await primitives.read(organizationId);

  if (!held || !held.running || !held.lockedAt || held.lockedAt.getTime() >= staleBefore.getTime()) {
    // Genuinely running, or held too recently to be considered abandoned.
    return { acquired: false };
  }

  // Atomic single-winner reclaim: `lockedAt < staleBefore` means that as
  // soon as ANY caller bumps `lockedAt` to `now`, every other concurrent
  // caller's predicate stops matching and they get 0 rows -> not acquired.
  if ((await primitives.reclaimIfStale(organizationId, now, staleBefore)) === 1) {
    return {
      acquired: true,
      reclaimedStaleLock: true,
      heldSince: held.lockedAt,
      staleLockAgeMs: now.getTime() - held.lockedAt.getTime(),
    };
  }

  return { acquired: false };
}

export function releasePersistedLock(
  primitives: PersistedLockPrimitives,
  organizationId: string,
): Promise<void> {
  return primitives.release(organizationId);
}

/**
 * Ensures an AutomationState row exists for this organization (first-ever
 * run), without disturbing an existing row's currentExportMode/lock state.
 * Prisma's upsert on a `@unique` field is an atomic INSERT ... ON CONFLICT
 * under Postgres, so this is safe even if two invocations race here.
 */
async function ensureAutomationStateRow(organizationId: string): Promise<void> {
  await prisma.automationState.upsert({
    where: { organizationId },
    create: { organizationId },
    update: {},
  });
}

/**
 * Production binding of the persisted-lock primitives to the
 * `AutomationState.isRunning`/`lockedAt` columns — the 15-minute Market
 * Price Optimization execution lock. Each primitive is one atomic Prisma
 * statement.
 */
const executionLockPrimitives: PersistedLockPrimitives = {
  ensureRow: ensureAutomationStateRow,
  claimIfFree: async (organizationId, now) =>
    (
      await prisma.automationState.updateMany({
        where: { organizationId, isRunning: false },
        data: { isRunning: true, lockedAt: now },
      })
    ).count,
  reclaimIfStale: async (organizationId, now, staleBefore) =>
    (
      await prisma.automationState.updateMany({
        where: { organizationId, isRunning: true, lockedAt: { lt: staleBefore } },
        data: { lockedAt: now },
      })
    ).count,
  read: async (organizationId) => {
    const row = await prisma.automationState.findUnique({
      where: { organizationId },
      select: { isRunning: true, lockedAt: true },
    });

    return row ? { running: row.isRunning, lockedAt: row.lockedAt } : null;
  },
  release: async (organizationId) => {
    await prisma.automationState.update({
      where: { organizationId },
      data: { isRunning: false },
    });
  },
};

/**
 * Production binding for the SEPARATE daily-reconciliation lock
 * (`reconciliationRunning`/`reconciliationLockedAt`). Deliberately touches
 * only those columns — never `isRunning`/`lockedAt` — so reconciliation can
 * run while an execution lock is held or stuck, which is precisely when it
 * is most needed. See the schema comment on `AutomationState`.
 */
const reconciliationLockPrimitives: PersistedLockPrimitives = {
  ensureRow: ensureAutomationStateRow,
  claimIfFree: async (organizationId, now) =>
    (
      await prisma.automationState.updateMany({
        where: { organizationId, reconciliationRunning: false },
        data: { reconciliationRunning: true, reconciliationLockedAt: now },
      })
    ).count,
  reclaimIfStale: async (organizationId, now, staleBefore) =>
    (
      await prisma.automationState.updateMany({
        where: {
          organizationId,
          reconciliationRunning: true,
          reconciliationLockedAt: { lt: staleBefore },
        },
        data: { reconciliationLockedAt: now },
      })
    ).count,
  read: async (organizationId) => {
    const row = await prisma.automationState.findUnique({
      where: { organizationId },
      select: { reconciliationRunning: true, reconciliationLockedAt: true },
    });

    return row
      ? { running: row.reconciliationRunning, lockedAt: row.reconciliationLockedAt }
      : null;
  },
  release: async (organizationId) => {
    await prisma.automationState.update({
      where: { organizationId },
      data: { reconciliationRunning: false },
    });
  },
};

/**
 * Acquires the per-organization 15-minute execution lock. Returns a
 * `LockAcquisition`: `{ acquired: false }` if a real run is in progress, or
 * `{ acquired: true, reclaimedStaleLock }` where `reclaimedStaleLock: true`
 * means the previous holder's process died before releasing and this call
 * took over the abandoned lock (`EXECUTION_LOCK_TTL_MS`). Callers must skip
 * the cycle without creating an event when not acquired, and must make a
 * reclaim observable when `reclaimedStaleLock` is true.
 */
export function acquireAutomationLock(organizationId: string): Promise<LockAcquisition> {
  return acquirePersistedLock(executionLockPrimitives, organizationId, EXECUTION_LOCK_TTL_MS);
}

/** Releases the execution lock acquired by `acquireAutomationLock` — always call in a `finally`. */
export function releaseAutomationLock(organizationId: string): Promise<void> {
  return releasePersistedLock(executionLockPrimitives, organizationId);
}

/**
 * Acquires the per-organization daily-reconciliation lock. Independent of
 * the execution lock (`acquireAutomationLock`): a held or stuck execution
 * lock never prevents this from succeeding. Prevents two reconciliation
 * runs for the same organization from overlapping, and is itself
 * failure-safe via `RECONCILIATION_LOCK_TTL_MS`.
 */
export function acquireReconciliationLock(organizationId: string): Promise<LockAcquisition> {
  return acquirePersistedLock(
    reconciliationLockPrimitives,
    organizationId,
    RECONCILIATION_LOCK_TTL_MS,
  );
}

/** Releases the reconciliation lock acquired by `acquireReconciliationLock` — always call in a `finally`. */
export function releaseReconciliationLock(organizationId: string): Promise<void> {
  return releasePersistedLock(reconciliationLockPrimitives, organizationId);
}

/** The last successfully applied (or reconciled) export mode — null before this organization's first execution. */
export async function getStoredExportMode(
  organizationId: string,
): Promise<ExportMode | null> {
  const state = await prisma.automationState.findUnique({
    where: { organizationId },
    select: { currentExportMode: true },
  });

  return (state?.currentExportMode as ExportMode | null) ?? null;
}

/** Updates the stored export mode — call ONLY after a successful Automation Service execution or reconciliation sync. */
export async function setStoredExportMode(
  organizationId: string,
  mode: ExportMode,
): Promise<void> {
  await prisma.automationState.update({
    where: { organizationId },
    data: { currentExportMode: mode },
  });
}

/**
 * Notification Provider milestone's anti-spam state (see
 * lib/automation/daily-reconciliation.ts): whether daily reconciliation is
 * currently unable to determine the real export mode. False until the
 * first reconciliation failure ever occurs for this organization.
 */
export async function isReconciliationFailing(
  organizationId: string,
): Promise<boolean> {
  const state = await prisma.automationState.findUnique({
    where: { organizationId },
    select: { reconciliationFailing: true },
  });

  return state?.reconciliationFailing ?? false;
}

/** Sets the reconciliation-failing flag — see isReconciliationFailing. */
export async function setReconciliationFailing(
  organizationId: string,
  failing: boolean,
): Promise<void> {
  await prisma.automationState.update({
    where: { organizationId },
    data: { reconciliationFailing: failing },
  });
}
