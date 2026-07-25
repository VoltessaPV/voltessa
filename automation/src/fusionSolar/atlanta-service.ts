import { readFile } from "node:fs/promises";

import {
  closeBrowserSession,
  discoverChildNodeNames,
  expandPlant,
  FusionSolarBrowserStepError,
  isDongleOnline,
  launchBrowserSession,
  login,
  openDeviceConfiguration,
  openDongle,
  readDeviceConfigField,
  reopenDeviceConfigurationAndRead,
  Selectors,
  selectPlant,
  clickSaveButton,
  confirmSaveDialogIfPresent,
  setActivePowerControlMode,
  waitForSaveConfirmation,
} from "./index.ts";

const ATLANTA_PLANT_NAME = "Atlanta";

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

export type StatusResult =
  | { success: true; timestamp: string; dongles: DongleStatus[]; log: string[] }
  | { success: false; timestamp: string; error: string; failure: FailureDetail; log: string[] };

export type DongleChangeOutcome = "Changed" | "Skipped" | "Failed";

export type DongleChangeResult = {
  name: string;
  before: string;
  after: string;
  result: DongleChangeOutcome;
  reason: string | null;
};

export type ChangeResult =
  | { success: true; timestamp: string; dongles: DongleChangeResult[]; log: string[] }
  | { success: false; timestamp: string; error: string; dongles: DongleChangeResult[]; failure: FailureDetail; log: string[] };

/** Small ordered collector for the human-readable execution log every
 *  endpoint returns - Voltessa displays this array directly. */
class ExecutionLog {
  private lines: string[] = [];

  add(line: string): void {
    this.lines.push(line);
  }

  separator(): void {
    this.lines.push("--------------------");
  }

  get(): string[] {
    return this.lines;
  }
}

/** Maps a raw FusionSolar Active Power Control value (Bulgarian) to the
 *  canonical English label this service's API contract uses. Anything
 *  that isn't one of the two known canonical values is reported as
 *  "Unknown" rather than guessed at. */
function describeMode(raw: string | null): string {
  if (raw === Selectors.deviceConfig.activePowerControlMode.zeroExport) {
    return "Zero Export";
  }

  if (raw === Selectors.deviceConfig.activePowerControlMode.noLimit) {
    return "No Limit";
  }

  return raw ?? "Unknown";
}

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

/** Builds the failure detail this service's API contract requires:
 *  current step, dongle, screenshot, and the original Playwright error -
 *  distinct from the wrapped FusionSolarBrowserStepError message. */
async function toFailureDetail(
  error: unknown,
  dongle: string | null,
): Promise<{ message: string; failure: FailureDetail }> {
  if (error instanceof FusionSolarBrowserStepError) {
    const original = error.cause;

    return {
      message: error.message,
      failure: {
        step: error.step,
        dongle,
        screenshotPath: error.screenshotPath,
        screenshotDataUrl: await readScreenshotAsDataUrl(error.screenshotPath),
        playwrightError: original instanceof Error ? original.message : String(original ?? error.message),
      },
    };
  }

  const message = error instanceof Error ? error.message : String(error);

  return {
    message,
    failure: {
      step: "unknown",
      dongle,
      screenshotPath: null,
      screenshotDataUrl: null,
      playwrightError: message,
    },
  };
}

/**
 * Read Status: for every request, open a fresh browser, log in, open
 * Atlanta, discover every dongle dynamically, and read its online status
 * and Active Power Control mode. Read-only. Never keeps the browser
 * alive past this one request.
 */
export async function readStatus(): Promise<StatusResult> {
  const log = new ExecutionLog();
  log.add("Starting...");

  const session = await launchBrowserSession();
  let currentDongle: string | null = null;

  try {
    log.add("Logging into FusionSolar...");
    const page = await login(session.page);

    await selectPlant(page, ATLANTA_PLANT_NAME);
    await expandPlant(page, ATLANTA_PLANT_NAME);
    log.add(`${ATLANTA_PLANT_NAME} opened.`);

    const dongleNames = await discoverChildNodeNames(page, ATLANTA_PLANT_NAME);
    log.add(`Found ${dongleNames.length} dongle${dongleNames.length === 1 ? "" : "s"}.`);

    const dongles: DongleStatus[] = [];

    for (const name of dongleNames) {
      currentDongle = name;
      log.add("");
      log.add(`Dongle ${name}`);

      const online = await isDongleOnline(page, name);
      await openDongle(page, name);
      await openDeviceConfiguration(page);

      const rawMode = await readDeviceConfigField(page, Selectors.deviceConfig.activePowerControlModeLabel);
      const mode = describeMode(rawMode);
      log.add(`Current mode: ${mode}`);

      dongles.push({ name, online, mode });
    }

    log.add("");
    log.add("Finished.");

    return { success: true, timestamp: new Date().toISOString(), dongles, log: log.get() };
  } catch (error) {
    const { message, failure } = await toFailureDetail(error, currentDongle);
    log.add(`Failed: ${message}`);

    return { success: false, timestamp: new Date().toISOString(), error: message, failure, log: log.get() };
  } finally {
    await closeBrowserSession(session);
  }
}

/**
 * Shared by enableZeroExport/enableNoLimit. For every request: open a
 * fresh browser, log in, open Atlanta, discover every dongle, and
 * process them strictly in sequence (never in parallel). A dongle
 * already in the target mode is skipped untouched (no Save); a dongle in
 * neither canonical mode is also left alone (never guess what an
 * unrecognized mode should become). Otherwise: change, Save, wait for
 * FusionSolar's own confirmation, reopen Configuration fresh, and verify
 * the reopened read matches the target exactly. The first verification
 * failure or automation error stops the whole run immediately - remaining
 * dongles are never touched.
 */
async function changeMode(targetLabel: "Zero Export" | "No Limit"): Promise<ChangeResult> {
  const log = new ExecutionLog();
  log.add("Starting...");

  const targetValue =
    targetLabel === "Zero Export"
      ? Selectors.deviceConfig.activePowerControlMode.zeroExport
      : Selectors.deviceConfig.activePowerControlMode.noLimit;
  const oppositeValue =
    targetLabel === "Zero Export"
      ? Selectors.deviceConfig.activePowerControlMode.noLimit
      : Selectors.deviceConfig.activePowerControlMode.zeroExport;

  const session = await launchBrowserSession();
  const changes: DongleChangeResult[] = [];
  let currentDongle: string | null = null;

  try {
    log.add("Logging into FusionSolar...");
    const page = await login(session.page);

    await selectPlant(page, ATLANTA_PLANT_NAME);
    await expandPlant(page, ATLANTA_PLANT_NAME);
    log.add(`${ATLANTA_PLANT_NAME} opened.`);

    const dongleNames = await discoverChildNodeNames(page, ATLANTA_PLANT_NAME);
    log.add(`Found ${dongleNames.length} dongle${dongleNames.length === 1 ? "" : "s"}.`);

    for (const name of dongleNames) {
      currentDongle = name;
      log.add("");
      log.add(`Dongle ${name}`);

      await openDongle(page, name);
      await openDeviceConfiguration(page);

      const beforeRaw = await readDeviceConfigField(page, Selectors.deviceConfig.activePowerControlModeLabel);
      const before = describeMode(beforeRaw);
      log.add(`Current mode: ${before}`);

      if (beforeRaw === targetValue) {
        log.add("Already configured.");
        log.add("Skipped.");
        log.separator();
        changes.push({ name, before, after: before, result: "Skipped", reason: `Already ${targetLabel}` });
        continue;
      }

      if (beforeRaw !== oppositeValue) {
        log.add("Not currently Zero Export or No Limit.");
        log.add("Skipped.");
        log.separator();
        changes.push({
          name,
          before,
          after: before,
          result: "Skipped",
          reason: "Not currently Zero Export or No Limit - left unchanged",
        });
        continue;
      }

      log.add("Changing...");
      await setActivePowerControlMode(page, targetValue);

      log.add("Saving...");
      await clickSaveButton(page);
      await confirmSaveDialogIfPresent(page);

      log.add("Waiting for confirmation...");
      await waitForSaveConfirmation(page);

      log.add("Reopening configuration...");
      const afterRaw = await reopenDeviceConfigurationAndRead(page, Selectors.deviceConfig.activePowerControlModeLabel);
      const after = describeMode(afterRaw);

      if (afterRaw !== targetValue) {
        log.add(`Verification failed: expected "${targetLabel}", found "${after}".`);

        changes.push({
          name,
          before,
          after,
          result: "Failed",
          reason: `Read-back verification failed: expected "${targetLabel}", found "${after}"`,
        });

        return {
          success: false,
          timestamp: new Date().toISOString(),
          error: `Read-back verification failed for "${name}" - stopped, remaining dongles were not processed`,
          dongles: changes,
          failure: {
            step: "verify",
            dongle: name,
            screenshotPath: null,
            screenshotDataUrl: null,
            playwrightError: `Expected Active Power Control mode "${targetLabel}", found "${after}" after reopening Configuration`,
          },
          log: log.get(),
        };
      }

      log.add("Verification passed.");
      log.separator();
      changes.push({ name, before, after, result: "Changed", reason: null });
    }

    log.add("Finished.");

    return { success: true, timestamp: new Date().toISOString(), dongles: changes, log: log.get() };
  } catch (error) {
    const { message, failure } = await toFailureDetail(error, currentDongle);
    log.add(`Failed: ${message}`);

    return { success: false, timestamp: new Date().toISOString(), error: message, dongles: changes, failure, log: log.get() };
  } finally {
    await closeBrowserSession(session);
  }
}

export function enableZeroExport(): Promise<ChangeResult> {
  return changeMode("Zero Export");
}

export function enableNoLimit(): Promise<ChangeResult> {
  return changeMode("No Limit");
}
