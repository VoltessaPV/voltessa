import type { RunStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { localDayBoundsUtc } from "@/lib/market-price/timezone";

import { getStoredExportMode } from "./automation-state";
import { createAutomationEvent } from "./automation-events";
import { classifyReconciliationRun, runDailyReconciliation } from "./daily-reconciliation";
import { findAtlantaOrganizationIds } from "./eligible-organizations";
import type { ExportMode } from "./export-decision";
import {
  ATLANTA_RECONCILIATION_SCHEDULE,
  decideReconciliationRetry,
  reconciliationSlotsForDate,
  type ReconciliationAttemptState,
} from "./reconciliation-retry-schedule";

const TIMEZONE = ATLANTA_RECONCILIATION_SCHEDULE.timeZone;

/**
 * The persisted-state operations `runAtlantaMorningReconciliation` needs,
 * factored behind an interface so the orchestration logic (idempotency,
 * stop-on-verify, exactly-one-final-notification) is unit-testable against
 * an in-memory store that models Postgres's atomic conditional UPDATE, with
 * no live database — same pattern as PR1's `PersistedLockPrimitives`.
 * Production binds these to the `AutomationReconciliationAttempt` table;
 * every mutating op is a single atomic statement (`updateMany` / `upsert`).
 */
export type ReconciliationAttemptStore = {
  /** Ensure a row exists for `(organizationId, reconciliationDate)` and return its current state. */
  loadOrCreate(organizationId: string, reconciliationDate: Date): Promise<ReconciliationAttemptState>;
  /**
   * Atomic per-slot claim. Succeeds (returns true) for exactly one caller
   * per slot: only if the morning has not already succeeded and
   * `lastDispatchedSlot < slotIndex`. Bumps `lastDispatchedSlot` and
   * `lastAttemptAt`.
   */
  claimSlot(
    organizationId: string,
    reconciliationDate: Date,
    slotIndex: number,
    now: Date,
  ): Promise<boolean>;
  /** Mark this morning verified (success). Increments `completedAttempts`, clears `lastFailureReason`. */
  markSucceeded(organizationId: string, reconciliationDate: Date, now: Date): Promise<void>;
  /** Record a completed-but-failed attempt: increments `completedAttempts`, stores `reason`. */
  recordCompletedFailure(
    organizationId: string,
    reconciliationDate: Date,
    reason: string,
  ): Promise<void>;
  /** Record an attempt that could not run (lock held by a prior attempt): stores `reason`, does NOT increment `completedAttempts`. */
  recordLockSkipped(
    organizationId: string,
    reconciliationDate: Date,
    reason: string,
  ): Promise<void>;
  /**
   * Atomic dedup for the single final-failure notification. Returns true
   * for exactly one caller: only if the morning has not succeeded and
   * `finalFailureNotifiedAt` is still null.
   */
  claimFinalFailureNotification(
    organizationId: string,
    reconciliationDate: Date,
    now: Date,
  ): Promise<boolean>;
};

const KEY = (organizationId: string, reconciliationDate: Date) => ({
  organizationId_reconciliationDate: { organizationId, reconciliationDate },
});

export const prismaReconciliationAttemptStore: ReconciliationAttemptStore = {
  async loadOrCreate(organizationId, reconciliationDate) {
    await prisma.automationReconciliationAttempt.upsert({
      where: KEY(organizationId, reconciliationDate),
      create: { organizationId, reconciliationDate },
      update: {},
    });

    const row = await prisma.automationReconciliationAttempt.findUnique({
      where: KEY(organizationId, reconciliationDate),
      select: {
        lastDispatchedSlot: true,
        completedAttempts: true,
        succeeded: true,
        finalFailureNotifiedAt: true,
        lastFailureReason: true,
      },
    });

    // upsert guarantees the row exists.
    return row!;
  },

  async claimSlot(organizationId, reconciliationDate, slotIndex, now) {
    const { count } = await prisma.automationReconciliationAttempt.updateMany({
      where: {
        organizationId,
        reconciliationDate,
        succeeded: false,
        lastDispatchedSlot: { lt: slotIndex },
      },
      data: { lastDispatchedSlot: slotIndex, lastAttemptAt: now },
    });

    return count === 1;
  },

  async markSucceeded(organizationId, reconciliationDate, now) {
    await prisma.automationReconciliationAttempt.updateMany({
      where: { organizationId, reconciliationDate },
      data: {
        succeeded: true,
        succeededAt: now,
        completedAttempts: { increment: 1 },
        lastFailureReason: null,
      },
    });
  },

  async recordCompletedFailure(organizationId, reconciliationDate, reason) {
    await prisma.automationReconciliationAttempt.updateMany({
      where: { organizationId, reconciliationDate, succeeded: false },
      data: { completedAttempts: { increment: 1 }, lastFailureReason: reason },
    });
  },

  async recordLockSkipped(organizationId, reconciliationDate, reason) {
    await prisma.automationReconciliationAttempt.updateMany({
      where: { organizationId, reconciliationDate, succeeded: false },
      data: { lastFailureReason: reason },
    });
  },

  async claimFinalFailureNotification(organizationId, reconciliationDate, now) {
    const { count } = await prisma.automationReconciliationAttempt.updateMany({
      where: {
        organizationId,
        reconciliationDate,
        succeeded: false,
        finalFailureNotifiedAt: null,
      },
      data: { finalFailureNotifiedAt: now },
    });

    return count === 1;
  },
};

/**
 * Sends the single "Atlanta morning reconciliation could not be completed"
 * signal: one `reconciliation_retry_exhausted` AutomationEvent (visible in
 * the admin Platform Logs view via `getPlatformLogs`, which reads every
 * event type) which in turn dispatches the Atlanta-specific ntfy
 * notification (`lib/notifications/automation-notifications.ts`). Caller
 * must already have won `claimFinalFailureNotification` so this fires at
 * most once per morning. A failed verification NEVER changes
 * `AutomationState.currentExportMode` and NEVER sends a FusionSolar
 * command — this only records/notifies.
 */
export async function sendReconciliationRetryExhaustedNotification(
  organizationId: string,
  storedMode: ExportMode | null,
  lastFailureReason: string,
): Promise<void> {
  await createAutomationEvent({
    organizationId,
    type: "reconciliation_retry_exhausted",
    summary: "Morning reconciliation could not be completed",
    reason:
      "Atlanta morning FusionSolar reconciliation failed on every scheduled attempt " +
      "(06:00–07:00 Europe/Sofia). The stored export mode was NOT changed and remains " +
      "unverified. No FusionSolar command was sent.",
    errorMessage: lastFailureReason,
    previousMode: storedMode,
    newMode: null,
  });
}

export type MorningReconciliationOrgResult =
  | { organizationId: string; action: "skip"; reason: string }
  | {
      organizationId: string;
      action: "attempted";
      slotIndex: number;
      isFinalSlot: boolean;
      status: RunStatus;
    }
  | { organizationId: string; action: "final_failure_notified" }
  | { organizationId: string; action: "final_failure_already_handled" };

type Overrides = {
  now?: Date;
  findOrganizations?: () => Promise<string[]>;
  store?: ReconciliationAttemptStore;
  /** One verification attempt for one org — the PR1 read-only flow. Returns the classified run status. */
  runOneReconciliation?: (organizationId: string) => Promise<RunStatus>;
  getStoredMode?: (organizationId: string) => Promise<ExportMode | null>;
  sendFinalFailureNotification?: (
    organizationId: string,
    storedMode: ExportMode | null,
    lastFailureReason: string,
  ) => Promise<void>;
};

async function defaultRunOneReconciliation(organizationId: string): Promise<RunStatus> {
  const outcomes = await runDailyReconciliation({
    findOrganizations: async () => [organizationId],
  });
  return classifyReconciliationRun(outcomes).status;
}

/**
 * The Atlanta morning-reconciliation retry orchestrator. Invoked by the
 * daily-reconciliation route on every one of the morning's scheduled
 * invocations (06:00/06:15/06:30/06:45/07:00 Europe/Sofia). Per Atlanta
 * organization:
 *
 *   1. derive today's Europe/Sofia `reconciliationDate` and slot instants;
 *   2. load/create the persisted `AutomationReconciliationAttempt` row;
 *   3. `decideReconciliationRetry` — skip (already verified / outside window
 *      / slot already dispatched) or dispatch an attempt for this slot;
 *   4. atomically claim the slot (exactly one concurrent invocation wins);
 *   5. run ONE read-only verification attempt via the PR1 flow
 *      (`runDailyReconciliation` → `classifyReconciliationRun`);
 *   6. SUCCESS → mark verified, stop retrying, NO notification (the PR1 flow
 *      already synchronized `currentExportMode` FROM the verified real
 *      state); FAILED/SKIPPED on the final (07:00) slot → send exactly ONE
 *      Atlanta failure notification (atomic dedup); FAILED/SKIPPED on an
 *      earlier slot → record it, no notification, a later slot retries.
 *
 * Never sends a FusionSolar mode-changing command and never writes
 * `AutomationState.currentExportMode` from anything other than the PR1
 * verified-sync path.
 */
export async function runAtlantaMorningReconciliation(
  overrides: Overrides = {},
): Promise<MorningReconciliationOrgResult[]> {
  const now = overrides.now ?? new Date();
  const findOrganizations = overrides.findOrganizations ?? findAtlantaOrganizationIds;
  const store = overrides.store ?? prismaReconciliationAttemptStore;
  const runOne = overrides.runOneReconciliation ?? defaultRunOneReconciliation;
  const getStoredMode = overrides.getStoredMode ?? getStoredExportMode;
  const sendFinalFailure =
    overrides.sendFinalFailureNotification ?? sendReconciliationRetryExhaustedNotification;

  const organizationIds = await findOrganizations();
  const reconciliationDate = localDayBoundsUtc(now, TIMEZONE).start;
  const slots = reconciliationSlotsForDate(now);
  const results: MorningReconciliationOrgResult[] = [];

  for (const organizationId of organizationIds) {
    const state = await store.loadOrCreate(organizationId, reconciliationDate);
    const decision = decideReconciliationRetry({ now, slots, state });

    if (decision.action === "skip") {
      results.push({ organizationId, action: "skip", reason: decision.reason });
      continue;
    }

    const { slotIndex, isFinalSlot } = decision;

    const claimed = await store.claimSlot(organizationId, reconciliationDate, slotIndex, now);
    if (!claimed) {
      // Another concurrent invocation claimed this slot (or the morning
      // already succeeded) — do not run a second reconciliation.
      results.push({ organizationId, action: "skip", reason: "slot_claimed_by_another_invocation" });
      continue;
    }

    const status = await runOne(organizationId);

    if (status === "SUCCESS") {
      await store.markSucceeded(organizationId, reconciliationDate, now);
      results.push({ organizationId, action: "attempted", slotIndex, isFinalSlot, status });
      continue;
    }

    const reason =
      status === "SKIPPED"
        ? "attempt could not run: a prior attempt was still in progress (reconciliation lock held)"
        : "reconciliation could not verify the FusionSolar state";

    if (status === "SKIPPED") {
      await store.recordLockSkipped(organizationId, reconciliationDate, reason);
    } else {
      await store.recordCompletedFailure(organizationId, reconciliationDate, reason);
    }

    if (isFinalSlot) {
      const won = await store.claimFinalFailureNotification(organizationId, reconciliationDate, now);
      if (won) {
        const storedMode = await getStoredMode(organizationId);
        await sendFinalFailure(organizationId, storedMode, state.lastFailureReason ?? reason);
        results.push({ organizationId, action: "final_failure_notified" });
        continue;
      }
      results.push({ organizationId, action: "final_failure_already_handled" });
      continue;
    }

    results.push({ organizationId, action: "attempted", slotIndex, isFinalSlot, status });
  }

  return results;
}

/**
 * Per-invocation `SchedulerRun` status for one morning tick. A tick that
 * dispatched an attempt which FAILED (or notified final failure) is FAILED
 * — visible in `getSchedulerHealth` — even if earlier/later slots may still
 * retry; a tick whose only attempt was lock-skipped is SKIPPED; a verifying
 * or no-op tick is SUCCESS.
 */
export function aggregateMorningReconciliationStatus(
  results: MorningReconciliationOrgResult[],
): { status: RunStatus; errorMessage?: string } {
  const attempts = results.filter(
    (r): r is Extract<MorningReconciliationOrgResult, { action: "attempted" }> =>
      r.action === "attempted",
  );
  const finalNotified = results.some((r) => r.action === "final_failure_notified");
  const anyFailed = attempts.some((r) => r.status === "FAILED");
  const anySkipped = attempts.some((r) => r.status === "SKIPPED");
  const anySuccess = attempts.some((r) => r.status === "SUCCESS");

  if (finalNotified) {
    return {
      status: "FAILED",
      errorMessage:
        "Atlanta morning reconciliation failed after all scheduled attempts (06:00–07:00 Europe/Sofia); final-failure notification sent.",
    };
  }
  if (anyFailed) {
    return {
      status: "FAILED",
      errorMessage: "Atlanta reconciliation attempt could not verify the FusionSolar state (retry pending).",
    };
  }
  if (anySkipped) {
    return { status: "SKIPPED" };
  }
  if (anySuccess) {
    return { status: "SUCCESS" };
  }
  return { status: "SUCCESS" };
}
