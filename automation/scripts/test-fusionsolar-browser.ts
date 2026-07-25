/**
 * Manual verification script for the FusionSolar browser-automation
 * foundation (Phase 1). Performs ONLY: launch, login, select Atlanta,
 * expand Atlanta, capture "plant-expanded", exit. Never opens
 * Configuration, never changes any setting, never presses Save - this
 * script exists purely to prove the read-only navigation layer is
 * reliable before any later phase builds write actions on top of it.
 *
 * Moved here (from the repo-root scripts/) when the browser automation
 * itself moved into this standalone Automation Service - node_modules
 * resolution for "playwright" requires this script to live under
 * automation/.
 *
 * Usage: from automation/, `npx tsx scripts/test-fusionsolar-browser.ts`
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const automationDir = path.resolve(scriptDir, "..");

for (const file of [".env.local", ".env"]) {
  const fullPath = path.join(automationDir, file);
  if (existsSync(fullPath)) {
    dotenv.config({ path: fullPath });
  }
}

import { closeBrowserSession, launchBrowserSession } from "../src/fusionSolar/browser";
import { login } from "../src/fusionSolar/login";
import { expandPlant, selectPlant } from "../src/fusionSolar/navigation";
import { capture } from "../src/fusionSolar/screenshots";

const ATLANTA_PLANT_NAME = "Atlanta";

async function main() {
  const session = await launchBrowserSession();

  try {
    const page = await login(session.page);

    await selectPlant(page, ATLANTA_PLANT_NAME);
    await expandPlant(page, ATLANTA_PLANT_NAME);
    await capture(page, "plant-expanded");

    console.log("FusionSolar browser automation verification succeeded.");
  } finally {
    await closeBrowserSession(session);
  }
}

main().catch((error) => {
  console.error("FusionSolar browser automation verification failed:", error);
  process.exitCode = 1;
});
