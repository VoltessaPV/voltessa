import { callAutomationService } from "@/lib/automation-client";

import type { DongleStatus, ReadStatusResult } from "@/app/dev/fusionsolar_atlanta/actions";
import {
  acquireAutomationLock,
  getStoredExportMode,
  isReconciliationFailing,
  releaseAutomationLock,
  setReconciliationFailing,
  setStoredExportMode,
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
  | { organizationId: string; outcome: "unexpected_error"; error: string };

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
 */
export async function runDailyReconciliation(): Promise<
  OrganizationReconciliationOutcome[]
> {
  const organizationIds = await findAtlantaOrganizationIds();
  const outcomes: OrganizationReconciliationOutcome[] = [];

  for (const organizationId of organizationIds) {
    const acquired = await acquireAutomationLock(organizationId);

    if (!acquired) {
      outcomes.push({ organizationId, outcome: "skipped_locked" });
      continue;
    }

    try {
      outcomes.push(await reconcileOrganization(organizationId));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      console.error("[Automation Daily Reconciliation] Unexpected error", {
        organizationId,
        error,
      });

      outcomes.push({ organizationId, outcome: "unexpected_error", error: reason });
    } finally {
      await releaseAutomationLock(organizationId);
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
