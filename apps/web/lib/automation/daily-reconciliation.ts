import { callAutomationService } from "@/lib/automation-client";

import type { DongleStatus, ReadStatusResult } from "@/app/dev/fusionsolar_atlanta/actions";
import {
  acquireAutomationLock,
  getStoredExportMode,
  releaseAutomationLock,
  setStoredExportMode,
} from "./automation-state";
import { createAutomationEvent } from "./automation-events";
import type { ExportMode } from "./export-decision";
import { findEligibleOrganizations } from "./eligible-organizations";

export type OrganizationReconciliationOutcome =
  | { organizationId: string; outcome: "skipped_locked" }
  | { organizationId: string; outcome: "automation_service_failed"; error: string }
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
 */
export async function runDailyReconciliation(): Promise<
  OrganizationReconciliationOutcome[]
> {
  const organizations = await findEligibleOrganizations();
  const outcomes: OrganizationReconciliationOutcome[] = [];

  for (const organization of organizations) {
    const acquired = await acquireAutomationLock(organization.organizationId);

    if (!acquired) {
      outcomes.push({ organizationId: organization.organizationId, outcome: "skipped_locked" });
      continue;
    }

    try {
      outcomes.push(await reconcileOrganization(organization.organizationId));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      console.error("[Automation Daily Reconciliation] Unexpected error", {
        organizationId: organization.organizationId,
        error,
      });

      outcomes.push({ organizationId: organization.organizationId, outcome: "unexpected_error", error: reason });
    } finally {
      await releaseAutomationLock(organization.organizationId);
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

    await createAutomationEvent({
      organizationId,
      type: "automation_service_failed",
      summary: "Automation Service failed",
      reason,
      previousMode: storedMode,
      newMode: null,
    });

    return { organizationId, outcome: "automation_service_failed", error: reason };
  }

  if (!result.success) {
    await createAutomationEvent({
      organizationId,
      type: "automation_service_failed",
      summary: "Automation Service failed",
      reason: result.error,
      previousMode: storedMode,
      newMode: null,
    });

    return { organizationId, outcome: "automation_service_failed", error: result.error };
  }

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
