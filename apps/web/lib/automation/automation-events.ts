import { prisma } from "@/lib/prisma";
import { sendAutomationNotification } from "@/lib/notifications/automation-notifications";

import type { ExportMode } from "./export-decision";

/**
 * The automation event log's closed-but-growable kind vocabulary (Market
 * Price Optimization Execution Engine milestone) — kept as a plain string
 * in the schema (see AutomationEvent's doc comment), typed here so callers
 * can't pass an arbitrary string. "reconciliation_failed"/
 * "reconciliation_restored" were added by the Notification Provider
 * milestone (see lib/automation/daily-reconciliation.ts) - previously
 * reconciliation's fatal-access-failure case reused
 * "automation_service_failed", but that made it indistinguishable from the
 * 15-minute execution engine's own failure case, which needed a different
 * notification (and different anti-spam behavior).
 */
export type AutomationEventType =
  | "mode_changed"
  | "automation_service_failed"
  | "reconciliation_mismatch"
  | "reconciliation_synced"
  | "reconciliation_failed"
  | "reconciliation_restored";

export type CreateAutomationEventInput = {
  organizationId: string;
  type: AutomationEventType;
  summary: string;
  reason: string;
  /** The real Automation Service/transport error - see AutomationEvent's doc comment. Only meaningful for "automation_service_failed". */
  errorMessage?: string | null;
  previousMode?: ExportMode | null;
  newMode?: ExportMode | null;
  currentPrice?: number | null;
  nextIntervalPrice?: number | null;
  /** AutomationSettings.minimumExportPrice in effect at decision time - only set for mode-change events. */
  threshold?: number | null;
};

/**
 * Creates one Automation Event row — the "automation must always be
 * traceable" principle (CLAUDE.md) applied to this engine. Called ONLY
 * when something actually happened (a mode switch, a failure, a
 * reconciliation mismatch/sync/restore); a normal scheduler tick that
 * decides no action is needed must never call this.
 *
 * Also the single trigger point for user-facing notifications (Notification
 * Provider milestone): AFTER this row has actually committed, dispatches to
 * lib/notifications/automation-notifications.ts, which decides whether
 * this event `type` warrants one and formats it if so. Callers (the
 * scheduler/reconciliation modules) never talk to a notification provider
 * themselves - "Scheduler MUST NOT contain notification logic." Wrapped in
 * its own try/catch as defense in depth on top of
 * sendAutomationNotification's own internal try/catch per provider - a
 * notification failure must never fail automation execution.
 */
export async function createAutomationEvent(
  input: CreateAutomationEventInput,
): Promise<void> {
  const event = await prisma.automationEvent.create({
    data: {
      organizationId: input.organizationId,
      type: input.type,
      summary: input.summary,
      reason: input.reason,
      errorMessage: input.errorMessage ?? null,
      previousMode: input.previousMode ?? null,
      newMode: input.newMode ?? null,
      currentPrice: input.currentPrice ?? null,
      nextIntervalPrice: input.nextIntervalPrice ?? null,
      threshold: input.threshold ?? null,
    },
  });

  try {
    await sendAutomationNotification({
      type: event.type,
      previousMode: event.previousMode,
      newMode: event.newMode,
      currentPrice: event.currentPrice ? Number(event.currentPrice.toString()) : null,
      threshold: event.threshold ? Number(event.threshold.toString()) : null,
      reason: event.reason,
      errorMessage: event.errorMessage,
      createdAt: event.createdAt,
    });
  } catch (error) {
    console.error("[Automation Events] Notification dispatch failed", {
      organizationId: input.organizationId,
      type: input.type,
      error,
    });
  }
}
