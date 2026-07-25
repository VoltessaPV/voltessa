import { prisma } from "@/lib/prisma";

import type { ExportMode } from "./export-decision";

/**
 * The automation event log's closed-but-growable kind vocabulary (Market
 * Price Optimization Execution Engine milestone) — kept as a plain string
 * in the schema (see AutomationEvent's doc comment), typed here so callers
 * can't pass an arbitrary string.
 */
export type AutomationEventType =
  | "mode_changed"
  | "automation_service_failed"
  | "reconciliation_mismatch"
  | "reconciliation_synced";

export type CreateAutomationEventInput = {
  organizationId: string;
  type: AutomationEventType;
  summary: string;
  reason: string;
  previousMode?: ExportMode | null;
  newMode?: ExportMode | null;
  currentPrice?: number | null;
  nextIntervalPrice?: number | null;
};

/**
 * Creates one Automation Event row — the "automation must always be
 * traceable" principle (CLAUDE.md) applied to this engine. Called ONLY
 * when something actually happened (a mode switch, a failure, a
 * reconciliation mismatch/sync); a normal scheduler tick that decides no
 * action is needed must never call this.
 */
export async function createAutomationEvent(
  input: CreateAutomationEventInput,
): Promise<void> {
  await prisma.automationEvent.create({
    data: {
      organizationId: input.organizationId,
      type: input.type,
      summary: input.summary,
      reason: input.reason,
      previousMode: input.previousMode ?? null,
      newMode: input.newMode ?? null,
      currentPrice: input.currentPrice ?? null,
      nextIntervalPrice: input.nextIntervalPrice ?? null,
    },
  });
}
