import { callAutomationService } from "@/lib/automation-client";
import { dbMarketPriceProvider } from "@/lib/market-price/provider";
import {
  AUTOMATION_RECOVERY_DEADLINE_MS,
  ensureBulgariaDeliveryDayAvailable,
} from "@/lib/market-price/ensure-delivery-day-available";
import { localDayBoundsUtc } from "@/lib/market-price/timezone";

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

const BULGARIA_TIMEZONE = "Europe/Sofia";

const AUTOMATION_SERVICE_PATH_BY_MODE: Record<ExportMode, string> = {
  "Zero Export": "/automation/fusionsolar/atlanta/zero-export",
  "No Limit": "/automation/fusionsolar/atlanta/no-limit",
};

/**
 * A failed Automation Service command is retried exactly once, after this
 * short delay, before the cycle gives up and waits for the next 15-minute
 * tick (see the Atlanta automation-failure investigation this responds to).
 * Both attempts happen inside the same executeForOrganization call, under
 * the same per-organization lock (acquired by the caller,
 * runMarketPriceOptimizationScheduler) — never deferred to a later tick or
 * a background job.
 */
const MODE_CHANGE_RETRY_DELAY_MS = 3000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ModeChangeAttemptResult =
  | { success: true; result: ChangeModeResult }
  | { success: false; error: string };

/**
 * One attempt at calling the Automation Service for a given mode - no event
 * creation, no state mutation, just the same success/failure normalization
 * executeForOrganization always needed (callAutomationService can both
 * throw and resolve with `success: false`; both collapse to the same
 * failure shape here so the retry can reuse this unchanged).
 */
async function attemptModeChange(newMode: ExportMode): Promise<ModeChangeAttemptResult> {
  try {
    const result = await callAutomationService<ChangeModeResult>(
      AUTOMATION_SERVICE_PATH_BY_MODE[newMode],
    );

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return { success: true, result };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

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
 * the systemd timer that calls it every 15 minutes). Before touching any
 * organization, ensures today's Bulgaria delivery day is available exactly
 * ONCE for the whole cycle (On-Demand Delivery Day Recovery milestone) -
 * never inside the per-organization loop below, since the price data is a
 * shared resource, not a per-organization one; recovering it once up front
 * means every organization's own `getCurrentPrice`/`getNextPrice` lookup
 * below sees the same, already-healed (or still genuinely unavailable) data.
 * Bounded by `AUTOMATION_RECOVERY_DEADLINE_MS` so a slow/unavailable
 * ENTSO-E can never risk overlapping the next 15-minute cycle. If recovery
 * fails or the day stays incomplete, nothing here changes: each
 * organization's own existing "no valid price -> skipped_no_price_data"
 * handling below is untouched and still applies.
 *
 * For each eligible organization (see findEligibleOrganizations): acquires
 * this organization's execution lock (skips silently, no event, if already
 * running - "never run two executions concurrently"), reads the current
 * and next market interval price plus the stored export mode, runs the
 * pure decision function, and — only if a mode switch is actually required
 * — calls the existing Automation Service and records the outcome.
 *
 * Never queries FusionSolar directly: `getStoredExportMode` reads
 * Voltessa's own stored state, never the plant itself (see
 * lib/automation/daily-reconciliation.ts for the one place that does read
 * FusionSolar, once a day).
 *
 * `overrides` exist only for tests - production callers always get the
 * real recovery safeguard and the real `findEligibleOrganizations`.
 */
export async function runMarketPriceOptimizationScheduler(
  overrides: {
    ensureRecovery?: () => Promise<void>;
    findOrganizations?: () => Promise<Awaited<ReturnType<typeof findEligibleOrganizations>>>;
  } = {},
): Promise<OrganizationExecutionOutcome[]> {
  const ensureRecovery =
    overrides.ensureRecovery ??
    (() =>
      ensureBulgariaDeliveryDayAvailable(
        localDayBoundsUtc(new Date(), BULGARIA_TIMEZONE).start,
        AUTOMATION_RECOVERY_DEADLINE_MS,
      ));
  const findOrganizations = overrides.findOrganizations ?? findEligibleOrganizations;

  await ensureRecovery();

  const organizations = await findOrganizations();
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
  // Automation Service's own failure response) - attemptModeChange collapses
  // both into one failure shape. A failed attempt is retried exactly once,
  // after MODE_CHANGE_RETRY_DELAY_MS, still under this organization's lock
  // (held by the caller for the whole executeForOrganization call) and
  // still the same decided newMode - nothing is re-evaluated between
  // attempts. Only once both attempts have failed is this treated as "the
  // Automation Service failed": an event created, the previous stored state
  // kept, and execution finished for this organization without aborting the
  // loop for the remaining ones.
  let attempt = await attemptModeChange(newMode);

  if (!attempt.success) {
    console.warn("[Market Price Optimization] Mode change attempt 1 failed, retrying once", {
      organizationId,
      newMode,
      error: attempt.error,
    });

    await delay(MODE_CHANGE_RETRY_DELAY_MS);

    attempt = await attemptModeChange(newMode);
  }

  if (!attempt.success) {
    console.error("[Market Price Optimization] Mode change failed after retry, giving up until next cycle", {
      organizationId,
      newMode,
      error: attempt.error,
    });

    await createAutomationEvent({
      organizationId,
      type: "automation_service_failed",
      summary: "Export mode change failed",
      reason: decision.reason,
      errorMessage: attempt.error,
      previousMode: storedMode,
      // The attempted (not achieved) mode - the failure notification shows
      // this as "Attempted: <previous> → <newMode>".
      newMode,
      currentPrice: currentPriceResult.price.price,
      nextIntervalPrice,
      threshold: minimumExportPrice,
    });

    return { organizationId, outcome: "automation_service_failed", error: attempt.error };
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
    threshold: minimumExportPrice,
  });

  return { organizationId, outcome: "switched", newMode, reason: decision.reason };
}
