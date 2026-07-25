"use server";

import { Permissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { callAutomationService } from "@/lib/automation-client";
import { prisma } from "@/lib/prisma";

const ATLANTA_PLANT_NAME = "Atlanta";

/**
 * The access boundary for this whole debug console: the caller's own
 * organization must own a Plant literally named "Atlanta". Re-checked in
 * every action here (not just the page's own render-time check) - never
 * trust the client alone. This check stays in Voltessa: it's a
 * multi-tenancy/authorization concern about who may call the Automation
 * Service, not FusionSolar knowledge - the Automation Service itself has
 * no concept of organizations.
 */
async function requireAtlantaOrganization(organizationId: string): Promise<boolean> {
  const plant = await prisma.plant.findFirst({
    where: { organizationId, name: ATLANTA_PLANT_NAME },
    select: { id: true },
  });

  return plant !== null;
}

export type DongleStatus = {
  name: string;
  online: boolean | null;
  mode: string;
};

export type FailureDetail = {
  step: string;
  dongle: string | null;
  screenshotPath: string | null;
  screenshotDataUrl: string | null;
  playwrightError: string;
};

export type ReadStatusResult =
  | { success: true; timestamp: string; dongles: DongleStatus[]; log: string[] }
  | { success: false; timestamp: string; error: string; failure?: FailureDetail; log: string[] };

export type DongleChangeOutcome = "Changed" | "Skipped" | "Failed";

export type DongleChangeResult = {
  name: string;
  before: string;
  after: string;
  result: DongleChangeOutcome;
  reason: string | null;
};

export type ChangeModeResult =
  | { success: true; timestamp: string; dongles: DongleChangeResult[]; log: string[] }
  | { success: false; timestamp: string; error: string; dongles: DongleChangeResult[]; failure?: FailureDetail; log: string[] };

async function requireAccess(): Promise<ReadStatusResult | null> {
  const user = await requirePermission(Permissions.canOperatePlants);

  if (!(await requireAtlantaOrganization(user.organizationId))) {
    return {
      success: false,
      timestamp: new Date().toISOString(),
      error: "This organization does not have an Atlanta plant",
      log: [],
    };
  }

  return null;
}

/** Read Status: calls the Automation Service, nothing else. Voltessa
 *  never launches Playwright and never knows anything about FusionSolar. */
export async function readFusionSolarAtlantaStatus(): Promise<ReadStatusResult> {
  const accessError = await requireAccess();
  if (accessError) {
    return accessError;
  }

  return callAutomationService<ReadStatusResult>("/automation/fusionsolar/atlanta/status");
}

export async function enableZeroExportForAtlanta(): Promise<ChangeModeResult> {
  const accessError = await requireAccess();
  if (accessError) {
    return { ...accessError, dongles: [] };
  }

  return callAutomationService<ChangeModeResult>("/automation/fusionsolar/atlanta/zero-export");
}

export async function enableNoLimitForAtlanta(): Promise<ChangeModeResult> {
  const accessError = await requireAccess();
  if (accessError) {
    return { ...accessError, dongles: [] };
  }

  return callAutomationService<ChangeModeResult>("/automation/fusionsolar/atlanta/no-limit");
}
