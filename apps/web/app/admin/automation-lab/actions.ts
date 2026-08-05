"use server";

import { AutomationService, type AutomationExecutionResult } from "@/lib/automation/automation-service";
import type { AutomationPayload, AutomationType } from "@/lib/automation/manufacturer-control-adapter";
import { requirePlatformAdmin } from "@/lib/auth/session";

export type RunAutomationResult =
  | { ok: true; result: AutomationExecutionResult }
  | { ok: false; error: string };

/**
 * Automation Lab's only Server Action — everything goes through
 * `AutomationService.execute`, never a vendor module directly. No business
 * logic lives here: this only enforces the Platform Admin gate and turns a
 * thrown error into the same `{ ok, error }` shape the page already renders
 * for a real automation failure, so the page never needs to distinguish
 * "AutomationService rejected this" from "the request itself was invalid."
 */
export async function runAutomation(
  plantId: string,
  automationType: AutomationType,
  payload: AutomationPayload,
): Promise<RunAutomationResult> {
  await requirePlatformAdmin();

  try {
    const result = await AutomationService.execute(plantId, automationType, payload);
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Automation execution failed" };
  }
}
