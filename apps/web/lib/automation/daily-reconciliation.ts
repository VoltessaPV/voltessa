import type { RunStatus } from "@prisma/client";

import { callAutomationService } from "@/lib/automation-client";

import type { DongleStatus, ReadStatusResult } from "@/app/dev/fusionsolar_atlanta/actions";
import {
  acquireReconciliationLock,
  getStoredExportMode,
  isReconciliationFailing,
  releaseReconciliationLock,
  setReconciliationFailing,
  setStoredExportMode,
  type LockAcquisition,
} from "./automation-state";
import { createAutomationEvent } from "./automation-events";
import type { ExportMode } from "./export-decision";
import { findAtlantaOrganizationIds } from "./eligible-organizations";

export type OrganizationReconciliationOutcome =
  | { organizationId: string; outcome: "skipped_locked" }
  | { organizationId: string; outcome: "reconciliation_failed"; error: string }
  | { organizationId: string; outcome: "already_matched"; mode: ExportMode | null }
  | { organizationId: string; outcome: "inconsistent_dongles" }
  | { organizationId: string; outcome: "synchronized"; previousMode: ExportMode | null; newMode: ExportMode }
  | { organizationId: string; outcome: "unexpected_error"; error: string }
  // A marker, not a verification result: a previous reconciliation run's
  // process died before releasing the reconciliation lock and this run
  // reclaimed the abandoned lock, then proceeded normally (a real
  // per-organization outcome is pushed after it).
  | {
      organizationId: string;
      outcome: "stale_lock_reclaimed";
      staleLockAgeMs: number;
      heldSince: string;
    };

/**
 * The reconciliation-run outcomes that mean "we established the real
 * FusionSolar state AND completed the comparison" — the ONLY ones that make
 * a reconciliation run a genuine SUCCESS. Everything else means the actual
 * state could not be verified.
 */
const VERIFIED_OUTCOMES: ReadonlySet<OrganizationReconciliationOutcome["outcome"]> = new Set([
  "already_matched",
  "synchronized",
]);

/**
 * Fail-closed reconciliation run status (Atlanta Automation incident
 * remediation, PR1). A run is SUCCESS only when every eligible organization
 * had its real FusionSolar state retrieved, evaluated, and compared. If any
 * organization could not be verified — Automation Service / Playwright /
 * login / timeout / network failure, inconsistent dongles (no single actual
 * mode), or an unexpected error — the run is FAILED, so
 * `SchedulerRun`/`getSchedulerHealth` carry that evidence after the fact
 * instead of a misleading green. A run held off ONLY by a concurrent
 * reconciliation (its own lock) is SKIPPED, not FAILED — nothing went
 * wrong, it simply did not run this time. `stale_lock_reclaimed` markers do
 * not count either way.
 */
export function classifyReconciliationRun(
  outcomes: OrganizationReconciliationOutcome[],
): { status: RunStatus; unverifiedOrganizationIds: string[] } {
  const results = outcomes.filter((outcome) => outcome.outcome !== "stale_lock_reclaimed");
  const unverified = results.filter((outcome) => !VERIFIED_OUTCOMES.has(outcome.outcome));

  if (unverified.length === 0) {
    // Every organization verified (or there were no Atlanta organizations
    // to reconcile at all — nothing to do is not a failure).
    return { status: "SUCCESS", unverifiedOrganizationIds: [] };
  }

  const onlyConcurrencySkips = unverified.every((outcome) => outcome.outcome === "skipped_locked");

  return {
    status: onlyConcurrencySkips ? "SKIPPED" : "FAILED",
    unverifiedOrganizationIds: unverified.map((outcome) => outcome.organizationId),
  };
}

/**
 * Every dongle is always switched together, to the same target mode, by
 * the Automation Service's zero-export/no-limit endpoints - so under
 * normal operation all three should agree. Returns null (not a single
 * mode) if they don't, which the caller treats as its own distinct case
 * rather than guessing which dongle is "right".
 */
function deriveFusionSolarMode(dongles: DongleStatus[]): ExportMode | null {
  const firstMode = dongles[0]?.mode;

  if (!firstMode) {
    return null;
  }

  const allAgree = dongles.every((dongle) => dongle.mode === firstMode);

  if (!allAgree) {
    return null;
  }

  return firstMode === "Zero Export" || firstMode === "No Limit" ? firstMode : null;
}

/**
 * The Market Price Optimization Execution Engine's daily reconciliation
 * (see app/api/internal/automation/daily-reconciliation/route.ts, the
 * systemd timer that calls it once daily at 06:00 Europe/Sofia). This is
 * the ONLY place in the execution engine that ever queries FusionSolar
 * directly (via the existing Automation Service's Read Status operation) -
 * the 15-minute scheduler never does, by design. Detects drift between
 * Voltessa's stored state and the plant's real state (e.g. a manual change
 * via /dev/huawei-api) and corrects Voltessa's own record to match reality
 * - it never changes the plant itself.
 *
 * Deliberately independent of AutomationSettings.automationEnabled (unlike
 * the 15-minute execution engine, which requires it) - reconciliation is
 * read-only and only ever updates Voltessa's own stored AutomationState,
 * never FusionSolar, so it stays safe to run regardless of whether
 * automation is currently enabled. This is what keeps AutomationState
 * accurate the moment automation is turned back on, instead of acting on
 * stale state from whenever it was last enabled.
 *
 * Atlanta Automation incident remediation (PR1): this uses its OWN lock
 * (acquireReconciliationLock), never the 15-minute execution lock. A held
 * or stuck execution lock must not be able to suppress reconciliation —
 * detecting exactly that situation (stored state drifted from the real
 * plant while an execution run died mid-flight) is reconciliation's whole
 * purpose. The reconciliation lock only stops two reconciliation runs for
 * the same organization from overlapping, and is itself failure-safe via a
 * TTL. Reconciliation still issues no state-changing FusionSolar command.
 *
 * `overrides` exist only for tests - production always uses the real
 * organization lookup, the real reconciliation lock, and the real
 * per-organization reconcile.
 */
export async function runDailyReconciliation(
  overrides: {
    findOrganizations?: () => Promise<string[]>;
    acquireLock?: (organizationId: string) => Promise<LockAcquisition>;
    releaseLock?: (organizationId: string) => Promise<void>;
    reconcileOrganization?: (organizationId: string) => Promise<OrganizationReconciliationOutcome>;
  } = {},
): Promise<OrganizationReconciliationOutcome[]> {
  const findOrganizations = overrides.findOrganizations ?? findAtlantaOrganizationIds;
  const acquireLock = overrides.acquireLock ?? acquireReconciliationLock;
  const releaseLock = overrides.releaseLock ?? releaseReconciliationLock;
  const reconcile = overrides.reconcileOrganization ?? reconcileOrganization;

  const organizationIds = await findOrganizations();
  const outcomes: OrganizationReconciliationOutcome[] = [];

  for (const organizationId of organizationIds) {
    const lock = await acquireLock(organizationId);

    if (!lock.acquired) {
      outcomes.push({ organizationId, outcome: "skipped_locked" });
      continue;
    }

    try {
      if (lock.reclaimedStaleLock) {
        // A previous reconciliation run's process died before releasing
        // this lock. Surface it in the outcomes for visibility; unlike the
        // execution-lock reclaim it gets no AutomationEvent — a stuck
        // reconciliation lock has no plant-safety impact (reconciliation
        // issues no command) and this stays within PR scope.
        console.warn("[Automation Daily Reconciliation] Reclaimed stale reconciliation lock", {
          organizationId,
          heldSince: lock.heldSince.toISOString(),
          staleLockAgeMs: lock.staleLockAgeMs,
        });
        outcomes.push({
          organizationId,
          outcome: "stale_lock_reclaimed",
          staleLockAgeMs: lock.staleLockAgeMs,
          heldSince: lock.heldSince.toISOString(),
        });
      }

      outcomes.push(await reconcile(organizationId));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      console.error("[Automation Daily Reconciliation] Unexpected error", {
        organizationId,
        error,
      });

      outcomes.push({ organizationId, outcome: "unexpected_error", error: reason });
    } finally {
      await releaseLock(organizationId);
    }
  }

  return outcomes;
}

async function reconcileOrganization(
  organizationId: string,
): Promise<OrganizationReconciliationOutcome> {
  const storedMode = await getStoredExportMode(organizationId);

  // callAutomationService can both throw (transport-level failure) and
  // resolve with `success: false` (the Automation Service's own failure
  // response) - both are treated identically here, matching
  // executeForOrganization's same handling in
  // market-price-optimization-scheduler.ts.
  let result: ReadStatusResult;

  try {
    result = await callAutomationService<ReadStatusResult>(
      "/automation/fusionsolar/atlanta/status",
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    await recordReconciliationFailure(organizationId, storedMode, reason);

    return { organizationId, outcome: "reconciliation_failed", error: reason };
  }

  if (!result.success) {
    await recordReconciliationFailure(organizationId, storedMode, result.error);

    return { organizationId, outcome: "reconciliation_failed", error: result.error };
  }

  // The Read Status call itself succeeded - FusionSolar access is working,
  // regardless of what the dongles report below. If reconciliation was
  // previously failing, this is the recovery moment.
  await recordReconciliationRecoveryIfNeeded(organizationId, storedMode);

  const fusionSolarMode = deriveFusionSolarMode(result.dongles);

  if (fusionSolarMode === null) {
    await createAutomationEvent({
      organizationId,
      type: "reconciliation_mismatch",
      summary: "FusionSolar state differed from Voltessa",
      reason: "FusionSolar dongles report inconsistent modes across the plant",
      previousMode: storedMode,
      newMode: null,
    });

    return { organizationId, outcome: "inconsistent_dongles" };
  }

  if (fusionSolarMode === storedMode) {
    return { organizationId, outcome: "already_matched", mode: storedMode };
  }

  await createAutomationEvent({
    organizationId,
    type: "reconciliation_mismatch",
    summary: "FusionSolar state differed from Voltessa",
    reason: `Voltessa recorded "${storedMode ?? "unknown"}", FusionSolar reported "${fusionSolarMode}"`,
    previousMode: storedMode,
    newMode: fusionSolarMode,
  });

  await setStoredExportMode(organizationId, fusionSolarMode);

  await createAutomationEvent({
    organizationId,
    type: "reconciliation_synced",
    summary: "Voltessa state synchronized with FusionSolar",
    reason: `Stored automation state updated to "${fusionSolarMode}" to match FusionSolar`,
    previousMode: storedMode,
    newMode: fusionSolarMode,
  });

  return { organizationId, outcome: "synchronized", previousMode: storedMode, newMode: fusionSolarMode };
}

/**
 * Anti-spam for reconciliation failures (Notification Provider milestone):
 * an AutomationEvent (and its notification) is only created on the
 * transition INTO a failing state, never repeated on every subsequent day
 * the same fatal FusionSolar access problem persists - "Day 2: login
 * failed → no notification." Still logged via console.error every day for
 * operational visibility, just without a duplicate event row.
 */
async function recordReconciliationFailure(
  organizationId: string,
  storedMode: ExportMode | null,
  reason: string,
): Promise<void> {
  const alreadyFailing = await isReconciliationFailing(organizationId);

  if (alreadyFailing) {
    console.error("[Automation Daily Reconciliation] Still failing (already notified)", {
      organizationId,
      reason,
    });

    return;
  }

  await setReconciliationFailing(organizationId, true);

  await createAutomationEvent({
    organizationId,
    type: "reconciliation_failed",
    summary: "Daily FusionSolar reconciliation failed",
    reason,
    previousMode: storedMode,
    newMode: null,
  });
}

/**
 * The other half of the anti-spam pair above: creates exactly ONE
 * "reconciliation_restored" event (and its notification) the first time
 * reconciliation succeeds again after having failed - a no-op if it
 * wasn't previously failing.
 */
async function recordReconciliationRecoveryIfNeeded(
  organizationId: string,
  storedMode: ExportMode | null,
): Promise<void> {
  const wasFailing = await isReconciliationFailing(organizationId);

  if (!wasFailing) {
    return;
  }

  await setReconciliationFailing(organizationId, false);

  await createAutomationEvent({
    organizationId,
    type: "reconciliation_restored",
    summary: "Daily FusionSolar reconciliation restored",
    reason: "FusionSolar access has been restored",
    previousMode: storedMode,
    newMode: null,
  });
}
