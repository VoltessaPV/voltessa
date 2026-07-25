/**
 * Manual verification script for the FusionSolar browser-automation
 * foundation (Phase 1). Performs ONLY: launch, login, select Atlanta,
 * expand Atlanta, capture "plant-expanded", exit. Never opens
 * Configuration, never changes any setting, never presses Save - this
 * script exists purely to prove the read-only navigation layer is
 * reliable before any later phase builds write actions on top of it.
 *
 * Usage: from apps/web, `npx tsx --env-file=.env.local ../../scripts/test-fusionsolar-browser.ts`
 */

import { existsSync } from "node:fs";
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

import { closeBrowserSession, launchBrowserSession } from "../apps/web/lib/fusionsolar/browser/browser";
import { login } from "../apps/web/lib/fusionsolar/browser/login";
import { expandPlant, selectPlant } from "../apps/web/lib/fusionsolar/browser/navigation";
import { capture } from "../apps/web/lib/fusionsolar/browser/screenshots";

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
