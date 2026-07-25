"use server";

import { readFile } from "node:fs/promises";

import { Permissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import {
  clickSaveButton,
  closeBrowserSession,
  confirmSaveDialogIfPresent,
  discoverChildNodeNames,
  expandPlant,
  FusionSolarBrowserStepError,
  launchBrowserSession,
  login,
  openDeviceConfiguration,
  openDongle,
  readDeviceConfigField,
  reopenDeviceConfigurationAndRead,
  Selectors,
  selectPlant,
  setActivePowerControlMode,
  waitForSaveConfirmation,
} from "@/lib/fusionsolar/browser";
import { prisma } from "@/lib/prisma";

const ATLANTA_PLANT_NAME = "Atlanta";

/**
 * The access boundary for this whole debug console: the caller's own
 * organization must own a Plant literally named "Atlanta". Re-checked in
 * every action here (not just the page's own render-time check) -
 * never trust the client alone, the same defense-in-depth already used
 * by app/(platform)/automations/actions.ts.
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
  activePowerControl: string | null;
};

export type FailureReport = {
  dongleName: string | null;
  step: string;
  url: string;
  screenshotPath: string | null;
  screenshotDataUrl: string | null;
  message: string;
};

export type ReadStatusResult =
  | { ok: true; plant: string; dongles: DongleStatus[] }
  | { ok: false; error: string; failure?: FailureReport };

export type DongleChangeOutcome = "Changed" | "Skipped" | "Failed";

export type DongleChangeResult = {
  name: string;
  before: string | null;
  after: string | null;
  result: DongleChangeOutcome;
  reason: string | null;
};

export type ChangeModeResult =
  | { ok: true; plant: string; targetLabel: string; changes: DongleChangeResult[] }
  | { ok: false; error: string; changes: DongleChangeResult[]; failure?: FailureReport };

/**
 * tmp/fusionsolar/ (see screenshots.ts) does not persist once a Vercel
 * serverless invocation ends, so the bare file path this reads is only
 * independently useful locally - reading it back as a data URL here
 * makes the failure screenshot actually visible in the UI regardless of
 * environment.
 */
async function readScreenshotAsDataUrl(path: string | null): Promise<string | null> {
  if (!path) {
    return null;
  }

  try {
    const buffer = await readFile(path);
    return `data:image/png;base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

async function toFailureReport(error: unknown, dongleName: string | null): Promise<FailureReport> {
  if (error instanceof FusionSolarBrowserStepError) {
    return {
      dongleName,
      step: error.step,
      url: error.url,
      screenshotPath: error.screenshotPath,
      screenshotDataUrl: await readScreenshotAsDataUrl(error.screenshotPath),
      message: error.message,
    };
  }

  return {
    dongleName,
    step: "unknown",
    url: "unknown",
    screenshotPath: null,
    screenshotDataUrl: null,
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Read Status: login, select Atlanta, expand its tree, discover every
 * Smart Dongle dynamically, and read each one's current Active Power
 * Control mode. Read-only - reuses the exact same navigation/reading
 * helpers as scripts/inspect-fusionsolar.ts, nothing new.
 */
export async function readFusionSolarAtlantaStatus(): Promise<ReadStatusResult> {
  const user = await requirePermission(Permissions.canOperatePlants);

  if (!(await requireAtlantaOrganization(user.organizationId))) {
    return { ok: false, error: "This organization does not have an Atlanta plant" };
  }

  let currentDongle: string | null = null;
  let session: Awaited<ReturnType<typeof launchBrowserSession>> | null = null;

  try {
    session = await launchBrowserSession();
    const page = await login(session.page);
    await selectPlant(page, ATLANTA_PLANT_NAME);
    await expandPlant(page, ATLANTA_PLANT_NAME);

    const dongleNames = await discoverChildNodeNames(page, ATLANTA_PLANT_NAME);
    const dongles: DongleStatus[] = [];

    for (const name of dongleNames) {
      currentDongle = name;
      await openDongle(page, name);
      await openDeviceConfiguration(page);

      const mode = await readDeviceConfigField(page, Selectors.deviceConfig.activePowerControlModeLabel);
      dongles.push({ name, activePowerControl: mode });
    }

    return { ok: true, plant: ATLANTA_PLANT_NAME, dongles };
  } catch (error) {
    const failure = await toFailureReport(error, currentDongle);
    return { ok: false, error: failure.message, failure };
  } finally {
    if (session) {
      await closeBrowserSession(session);
    }
  }
}

/**
 * Shared by enableZeroExportForAtlanta/enableNoLimitForAtlanta. For
 * every dongle, sequentially (never in parallel): open Configuration,
 * read the current mode, and only if it's currently the OPPOSITE
 * canonical mode, change it - Save, wait for FusionSolar's own
 * confirmation (never a fixed sleep), then read the mode back and
 * verify it matches exactly what was requested. A dongle already in the
 * target mode is left completely alone (no Save); a dongle in neither
 * canonical mode is also left alone (never guess what an unrecognized
 * mode should become). The first read-back mismatch or automation
 * failure stops the whole run immediately - remaining dongles are never
 * touched.
 */
async function changeAllDonglesTo(targetLabel: "Zero Export" | "No Limit"): Promise<ChangeModeResult> {
  const user = await requirePermission(Permissions.canOperatePlants);

  if (!(await requireAtlantaOrganization(user.organizationId))) {
    return { ok: false, error: "This organization does not have an Atlanta plant", changes: [] };
  }

  const targetValue =
    targetLabel === "Zero Export"
      ? Selectors.deviceConfig.activePowerControlMode.zeroExport
      : Selectors.deviceConfig.activePowerControlMode.noLimit;
  const oppositeValue =
    targetLabel === "Zero Export"
      ? Selectors.deviceConfig.activePowerControlMode.noLimit
      : Selectors.deviceConfig.activePowerControlMode.zeroExport;

  const changes: DongleChangeResult[] = [];
  let currentDongle: string | null = null;
  let session: Awaited<ReturnType<typeof launchBrowserSession>> | null = null;

  try {
    session = await launchBrowserSession();
    const page = await login(session.page);
    await selectPlant(page, ATLANTA_PLANT_NAME);
    await expandPlant(page, ATLANTA_PLANT_NAME);

    const dongleNames = await discoverChildNodeNames(page, ATLANTA_PLANT_NAME);

    for (const name of dongleNames) {
      currentDongle = name;
      await openDongle(page, name);
      await openDeviceConfiguration(page);

      const before = await readDeviceConfigField(page, Selectors.deviceConfig.activePowerControlModeLabel);

      if (before === targetValue) {
        changes.push({ name, before, after: before, result: "Skipped", reason: `Already ${targetLabel}` });
        continue;
      }

      if (before !== oppositeValue) {
        changes.push({
          name,
          before,
          after: before,
          result: "Skipped",
          reason: "Not currently Zero Export or No Limit - left unchanged",
        });
        continue;
      }

      await setActivePowerControlMode(page, targetValue);
      await clickSaveButton(page);
      await confirmSaveDialogIfPresent(page);
      await waitForSaveConfirmation(page);

      // Verify from a freshly re-opened Configuration page, not the page
      // that performed the Save - avoids validating stale UI state
      // instead of what FusionSolar actually persisted.
      const after = await reopenDeviceConfigurationAndRead(page, Selectors.deviceConfig.activePowerControlModeLabel);

      if (after !== targetValue) {
        changes.push({
          name,
          before,
          after,
          result: "Failed",
          reason: `Read-back verification failed: expected "${targetLabel}", found "${after ?? "unknown"}"`,
        });

        return {
          ok: false,
          error: `Read-back verification failed for "${name}" - stopped, remaining dongles were not processed`,
          changes,
        };
      }

      changes.push({ name, before, after, result: "Changed", reason: null });
    }

    return { ok: true, plant: ATLANTA_PLANT_NAME, targetLabel, changes };
  } catch (error) {
    const failure = await toFailureReport(error, currentDongle);
    return { ok: false, error: failure.message, changes, failure };
  } finally {
    if (session) {
      await closeBrowserSession(session);
    }
  }
}

export async function enableZeroExportForAtlanta(): Promise<ChangeModeResult> {
  return changeAllDonglesTo("Zero Export");
}

export async function enableNoLimitForAtlanta(): Promise<ChangeModeResult> {
  return changeAllDonglesTo("No Limit");
}
