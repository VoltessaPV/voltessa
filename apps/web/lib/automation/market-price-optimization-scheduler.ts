import { callAutomationService } from "@/lib/automation-client";
import { dbMarketPriceProvider } from "@/lib/market-price/provider";

import type { ChangeModeResult } from "@/app/dev/fusionsolar_atlanta/actions";
import {
  acquireAutomationLock,
  getStoredExportMode,
  releaseAutomationLock,
  setStoredExportMode,
} from "./automation-state";
import { createAutomationEvent } from "./automation-events";
import { decideExportAction, type ExportMode } from "./export-decision";
import { findEligibleOrganizations } from "./eligible-organizations";

const AUTOMATION_SERVICE_PATH_BY_MODE: Record<ExportMode, string> = {
  "Zero Export": "/automation/fusionsolar/atlanta/zero-export",
  "No Limit": "/automation/fusionsolar/atlanta/no-limit",
};

export type OrganizationExecutionOutcome =
  | { organizationId: string; outcome: "skipped_locked" }
  | { organizationId: string; outcome: "skipped_no_price_data" }
  | { organizationId: string; outcome: "no_action"; reason: string }
  | { organizationId: string; outcome: "switched"; newMode: ExportMode; reason: string }
  | { organizationId: string; outcome: "automation_service_failed"; error: string }
  | { organizationId: string; outcome: "unexpected_error"; error: string };

/**
 * The Market Price Optimization Execution Engine's 15-minute cycle (see
 * app/api/internal/automation/execute-market-price-optimization/route.ts,
 * the systemd timer that calls it every 15 minutes). For each eligible
 * organization (see findEligibleOrganizations): acquires this
 * organization's execution lock (skips silently, no event, if already
 * running - "never run two executions concurrently"), reads the current
 * and next market interval price plus the stored export mode, runs the
 * pure decision function, and — only if a mode switch is actually required
 * — calls the existing Automation Service and records the outcome.
 *
 * Never queries FusionSolar directly: `getStoredExportMode` reads
 * Voltessa's own stored state, never the plant itself (see
 * lib/automation/daily-reconciliation.ts for the one place that does read
 * FusionSolar, once a day).
 */
export async function runMarketPriceOptimizationScheduler(): Promise<
  OrganizationExecutionOutcome[]
> {
  const organizations = await findEligibleOrganizations();
  const outcomes: OrganizationExecutionOutcome[] = [];

  for (const organization of organizations) {
    const acquired = await acquireAutomationLock(organization.organizationId);

    if (!acquired) {
      outcomes.push({ organizationId: organization.organizationId, outcome: "skipped_locked" });
      continue;
    }

    try {
      outcomes.push(await executeForOrganization(organization));
    } catch (error) {
      // An unexpected error (not a known Automation Service failure, which
      // executeForOrganization already handles without throwing) for one
      // organization must not abort the cycle for the remaining ones.
      const reason = error instanceof Error ? error.message : String(error);

      console.error("[Market Price Optimization] Unexpected error", {
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

async function executeForOrganization(organization: {
  organizationId: string;
  minimumExportPrice: number;
}): Promise<OrganizationExecutionOutcome> {
  const { organizationId, minimumExportPrice } = organization;

  const [currentPriceResult, nextPriceResult, storedMode] = await Promise.all([
    dbMarketPriceProvider.getCurrentPrice(),
    dbMarketPriceProvider.getNextPrice(),
    getStoredExportMode(organizationId),
  ]);

  if (!currentPriceResult.available) {
    console.log("[Market Price Optimization] Skipped - no current price data", {
      organizationId,
      reason: currentPriceResult.reason,
    });

    return { organizationId, outcome: "skipped_no_price_data" };
  }

  const nextIntervalPrice = nextPriceResult.available ? nextPriceResult.price.price : null;

  const decision = decideExportAction({
    currentPrice: currentPriceResult.price.price,
    nextIntervalPrice,
    threshold: minimumExportPrice,
    currentMode: storedMode,
  });

  if (decision.action === "NONE") {
    return { organizationId, outcome: "no_action", reason: decision.reason };
  }

  const newMode: ExportMode =
    decision.action === "SWITCH_TO_ZERO_EXPORT" ? "Zero Export" : "No Limit";

  // callAutomationService can both throw (transport-level failure - timeout,
  // network error, missing config) and resolve with `success: false` (the
  // Automation Service's own failure response) - both must be treated as
  // "the Automation Service failed" here: an event created, the previous
  // stored state kept, and execution finished for this organization without
  // aborting the loop for the remaining ones.
  let result: ChangeModeResult;

  try {
    result = await callAutomationService<ChangeModeResult>(
      AUTOMATION_SERVICE_PATH_BY_MODE[newMode],
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
      currentPrice: currentPriceResult.price.price,
      nextIntervalPrice,
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
      currentPrice: currentPriceResult.price.price,
      nextIntervalPrice,
    });

    return { organizationId, outcome: "automation_service_failed", error: result.error };
  }

  await setStoredExportMode(organizationId, newMode);

  await createAutomationEvent({
    organizationId,
    type: "mode_changed",
    summary: newMode === "Zero Export" ? "Switched to Zero Export" : "Switched to No Limit",
    reason: decision.reason,
    previousMode: storedMode,
    newMode,
    currentPrice: currentPriceResult.price.price,
    nextIntervalPrice,
  });

  return { organizationId, outcome: "switched", newMode, reason: decision.reason };
}
