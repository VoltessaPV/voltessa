import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export type FusionSolarBrowserSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
};

const VIEWPORT = { width: 1440, height: 900 };

/**
 * Owns only Playwright process/browser/context/page lifecycle for
 * FusionSolar automation - no FusionSolar-specific logic (login,
 * navigation) belongs here. Always headless: this runs as unattended
 * automation, not an interactive session.
 */
export async function launchBrowserSession(): Promise<FusionSolarBrowserSession> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();

  return { browser, context, page };
}

/** Closes the context then the browser. Always call this, including on failure. */
export async function closeBrowserSession(session: FusionSolarBrowserSession): Promise<void> {
  await session.context.close();
  await session.browser.close();
}
