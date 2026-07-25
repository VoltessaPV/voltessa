/**
 * Manual inspection script (Phase 2: read-only). Reports the current
 * export-control configuration of every Smart Dongle under the Atlanta
 * plant - Active Power Control mode, firmware, and online status,
 * dynamically discovered from the live plant/device tree (never a
 * hardcoded dongle name or count). Never modifies anything in
 * FusionSolar: no Save, no Zero Export, no No Limit.
 *
 * Manual execution only - not wired into any build hook, test, or
 * startup path.
 *
 * Usage: from apps/web, `npx tsx --env-file=.env.local ../../scripts/inspect-fusionsolar.ts`
 *
 * Writes tmp/fusionsolar/report.json plus a numbered screenshot per step
 * (01-login, 02-atlanta-expanded, then one per discovered dongle).
 */

import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, "../apps/web");

for (const file of [".env.local", ".env"]) {
  const fullPath = path.join(webDir, file);
  if (existsSync(fullPath)) {
    dotenv.config({ path: fullPath });
  }
}

import type { Page } from "playwright";

import { closeBrowserSession, launchBrowserSession } from "../apps/web/lib/fusionsolar/browser/browser";
import { login } from "../apps/web/lib/fusionsolar/browser/login";
import {
  discoverChildNodeNames,
  expandPlant,
  isDongleOnline,
  openDeviceConfiguration,
  openDongle,
  readDeviceConfigField,
  selectPlant,
} from "../apps/web/lib/fusionsolar/browser/navigation";
import { capture, SCREENSHOT_DIR } from "../apps/web/lib/fusionsolar/browser/screenshots";
import { Selectors } from "../apps/web/lib/fusionsolar/browser/selectors";

const PLANT_NAME = "Atlanta";

type DongleReport = {
  name: string;
  online: boolean | null;
  configurationFound: boolean;
  activePowerControl: string | null;
  exportLimit: string | null;
  activePowerLimit: string | null;
  firmware: string | null;
  screenshot: string | null;
};

function screenshotBaseName(index: number, dongleName: string): string {
  const sanitized = dongleName.replace(/[^a-zA-Z0-9-]+/g, "_");
  return `${String(index).padStart(2, "0")}-${sanitized}`;
}

/**
 * Inspects a single dongle: online status (from the tree), its
 * Configuration tab's Active Power Control mode and firmware version,
 * and a screenshot. exportLimit/activePowerLimit are always null - no
 * distinctly-labeled field for either was found on the real
 * Configuration page during verification (see selectors.ts), and this
 * script never guesses a value it can't confirm.
 *
 * Failures are caught here (not rethrown) so one dongle's problem
 * doesn't stop the rest from being inspected and reported -
 * configurationFound stays false and the failure is logged with the
 * dongle name attached.
 */
async function inspectDongle(page: Page, index: number, name: string): Promise<DongleReport> {
  const report: DongleReport = {
    name,
    online: null,
    configurationFound: false,
    activePowerControl: null,
    exportLimit: null,
    activePowerLimit: null,
    firmware: null,
    screenshot: null,
  };

  try {
    report.online = await isDongleOnline(page, name);

    await openDongle(page, name);
    await openDeviceConfiguration(page);

    report.activePowerControl = await readDeviceConfigField(
      page,
      Selectors.deviceConfig.activePowerControlModeLabel,
    );
    report.firmware = await readDeviceConfigField(page, Selectors.deviceConfig.firmwareVersionLabel);
    report.configurationFound = report.activePowerControl !== null;

    const baseName = screenshotBaseName(index, name);
    await capture(page, baseName);
    report.screenshot = `${baseName}.png`;
  } catch (error) {
    console.error(`Dongle "${name}": inspection failed -`, error instanceof Error ? error.message : error);
  }

  return report;
}

function printDongleSummary(report: DongleReport): void {
  console.log(`\n${report.name}`);
  console.log("-".repeat(report.name.length));
  console.log(`Status: ${report.online === null ? "Unknown" : report.online ? "Online" : "Offline"}`);
  console.log(`Mode: ${report.activePowerControl ?? "Unknown"}`);

  if (report.exportLimit) {
    console.log(`Export Limit: ${report.exportLimit}`);
  }
}

function printOverallSummary(reports: DongleReport[]): void {
  console.log("\nSummary\n");
  console.log(`Plant: ${PLANT_NAME}`);
  console.log(`Dongles inspected: ${reports.length}`);
  console.log();

  const modeCounts = new Map<string, number>();

  for (const report of reports) {
    const mode = report.activePowerControl ?? "Unknown";
    modeCounts.set(mode, (modeCounts.get(mode) ?? 0) + 1);
  }

  for (const [mode, count] of modeCounts) {
    console.log(`${mode}: ${count}`);
  }
}

async function main() {
  const session = await launchBrowserSession();

  try {
    const page = await login(session.page);
    await capture(page, "01-login");

    await selectPlant(page, PLANT_NAME);
    await expandPlant(page, PLANT_NAME);
    await capture(page, "02-atlanta-expanded");

    const dongleNames = await discoverChildNodeNames(page, PLANT_NAME);

    if (dongleNames.length === 0) {
      console.warn(`No child devices discovered under "${PLANT_NAME}".`);
    }

    const dongleReports: DongleReport[] = [];
    let index = 3;

    for (const name of dongleNames) {
      dongleReports.push(await inspectDongle(page, index, name));
      index += 1;
    }

    await writeFile(
      path.join(SCREENSHOT_DIR, "report.json"),
      JSON.stringify(
        {
          plant: PLANT_NAME,
          generatedAt: new Date().toISOString(),
          dongles: dongleReports,
        },
        null,
        2,
      ),
      "utf-8",
    );

    console.log(`Plant: ${PLANT_NAME}`);
    dongleReports.forEach(printDongleSummary);
    printOverallSummary(dongleReports);
  } finally {
    await closeBrowserSession(session);
  }
}

main().catch((error) => {
  console.error("FusionSolar inspection failed:", error);
  process.exitCode = 1;
});
