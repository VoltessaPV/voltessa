import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

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
 * True in a deployed Vercel serverless function - the only environment
 * where the full "playwright" package's own bundled Chromium binary
 * isn't available (it's a devDependency, present locally and in CI, but
 * never shipped in a deployed function) and @sparticuz/chromium's
 * Lambda-compatible build must be used instead.
 */
function isServerlessEnvironment(): boolean {
  return Boolean(process.env.VERCEL) || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
}

async function resolveLaunchOptions(): Promise<Parameters<typeof chromium.launch>[0]> {
  if (isServerlessEnvironment()) {
    const sparticuzChromium = (await import("@sparticuz/chromium")).default;

    return {
      args: sparticuzChromium.args,
      executablePath: await sparticuzChromium.executablePath(),
      headless: true,
    };
  }

  // Local dev (including `next dev`): reuse the full "playwright"
  // package's own pre-installed Chromium binary instead of managing a
  // second copy - "playwright" is a devDependency for exactly this.
  const { chromium: localPlaywright } = await import("playwright");

  return {
    executablePath: localPlaywright.executablePath(),
    headless: true,
  };
}

/**
 * Owns only Playwright process/browser/context/page lifecycle for
 * FusionSolar automation - no FusionSolar-specific logic (login,
 * navigation) belongs here. Always headless: this runs as unattended
 * automation, not an interactive session.
 *
 * Launches via playwright-core (the actual automation driver, in both
 * environments) with the Chromium binary sourced differently depending
 * on where this runs - @sparticuz/chromium's Lambda/Vercel-compatible
 * build in production (its 149.x release matches the Chromium major
 * version this exact playwright-core release itself expects), or the
 * full "playwright" package's own bundled binary locally. The
 * serverless path could not be exercised end-to-end from local
 * development (the bundled binary is Linux-only, not runnable on a
 * non-Linux dev machine) - it needs verifying against a real Vercel
 * deployment.
 */
export async function launchBrowserSession(): Promise<FusionSolarBrowserSession> {
  const launchOptions = await resolveLaunchOptions();
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ viewport: VIEWPORT, locale: LOCALE });
  const page = await context.newPage();

  return { browser, context, page };
}

/** Closes the context then the browser. Always call this, including on failure. */
export async function closeBrowserSession(session: FusionSolarBrowserSession): Promise<void> {
  await session.context.close();
  await session.browser.close();
}
