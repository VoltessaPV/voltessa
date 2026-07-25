import { mkdir } from "node:fs/promises";
import path from "node:path";

import type { Page } from "playwright";

/** tmp/fusionsolar/ - shared by every screenshot this module writes and
 *  by scripts/inspect-fusionsolar.ts's report.json, so both land in the
 *  same place without hardcoding the path twice. */
export const SCREENSHOT_DIR = path.join(process.cwd(), "tmp", "fusionsolar");

let directoryReady: Promise<void> | null = null;

/** Creates tmp/fusionsolar/ if it doesn't already exist. Exported so
 *  callers writing other files into the same directory (e.g. report.json)
 *  can reuse this instead of duplicating the mkdir call. */
export function ensureScreenshotDirectory(): Promise<void> {
  directoryReady ??= mkdir(SCREENSHOT_DIR, { recursive: true }).then(() => undefined);
  return directoryReady;
}

/**
 * Saves a full-page screenshot to tmp/fusionsolar/<name>.png and returns
 * the file path. `name` carries its own ordering (e.g. "01-login",
 * "plant-expanded") - this function only writes the file, callers choose
 * the sequence/naming.
 */
export async function capture(page: Page, name: string): Promise<string> {
  await ensureScreenshotDirectory();

  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);

  await page.screenshot({ path: filePath, fullPage: true });

  return filePath;
}
