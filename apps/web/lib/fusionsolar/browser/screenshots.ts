import { mkdir } from "node:fs/promises";
import path from "node:path";

import type { Page } from "playwright";

const SCREENSHOT_DIR = path.join(process.cwd(), "tmp", "fusionsolar");

let directoryReady: Promise<void> | null = null;

function ensureScreenshotDirectory(): Promise<void> {
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
