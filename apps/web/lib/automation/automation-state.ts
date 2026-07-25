import { prisma } from "@/lib/prisma";

import type { ExportMode } from "./export-decision";

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
 * Acquires the per-organization execution lock (Market Price Optimization
 * Execution Engine milestone). Both the 15-minute scheduler and the daily
 * reconciliation job call this before touching AutomationState/
 * AutomationEvent for an organization, so the two never run concurrently
 * with each other or with themselves for the same organization.
 *
 * Reuses the AutomationState row itself (isRunning/lockedAt) rather than a
 * dedicated lock table — this row already exists per organization and is
 * exactly what needs protecting. Acquired via a conditional `updateMany`
 * (atomic check-and-set at the database level, not a read-then-write) so
 * this is race-safe even under real concurrent invocations — Vercel
 * Functions are stateless across invocations, so an in-memory lock cannot
 * work here; mutual exclusion has to live in the one thing every
 * invocation shares, the database.
 *
 * Returns false (lock not acquired — caller must skip this cycle without
 * creating an event) if another execution is already running for this
 * organization.
 */
export async function acquireAutomationLock(
  organizationId: string,
): Promise<boolean> {
  await ensureAutomationStateRow(organizationId);

  const { count } = await prisma.automationState.updateMany({
    where: { organizationId, isRunning: false },
    data: { isRunning: true, lockedAt: new Date() },
  });

  return count === 1;
}

/** Releases the lock acquired by `acquireAutomationLock` — always call in a `finally`. */
export async function releaseAutomationLock(
  organizationId: string,
): Promise<void> {
  await prisma.automationState.update({
    where: { organizationId },
    data: { isRunning: false },
  });
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
