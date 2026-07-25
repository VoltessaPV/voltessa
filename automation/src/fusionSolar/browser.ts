import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export type FusionSolarBrowserSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
};

const VIEWPORT = { width: 1440, height: 900 };

/**
 * Every text-based selector in this module (tab titles, field labels,
 * dropdown option text) was confirmed against FusionSolar's Bulgarian
 * UI - but the portal picks its rendering language from the browser's
 * own Accept-Language, not a fixed per-account setting: a run without
 * an explicit locale rendered the entire UI in English instead,
 * silently breaking every one of those selectors. Pinning the context's
 * locale makes which language renders deterministic, matching what the
 * automation was actually built against.
 */
const LOCALE = "bg-BG";

/**
 * Owns only Playwright process/browser/context/page lifecycle for
 * FusionSolar automation - no FusionSolar-specific logic (login,
 * navigation) belongs here. Always headless: this runs as unattended
 * automation, not an interactive session.
 *
 * This service is a persistent Node process (never a Vercel serverless
 * function), so it always uses the plain "playwright" package's own
 * managed Chromium install directly - no @sparticuz/chromium, no
 * serverless-vs-local branching. That branching existed only to work
 * around Vercel's ephemeral filesystem when this automation still ran
 * inside apps/web; it doesn't apply here.
 */
export async function launchBrowserSession(): Promise<FusionSolarBrowserSession> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT, locale: LOCALE });
  const page = await context.newPage();

  return { browser, context, page };
}

/** Closes the context then the browser. Always call this, including on failure. */
export async function closeBrowserSession(session: FusionSolarBrowserSession): Promise<void> {
  await session.context.close();
  await session.browser.close();
}
