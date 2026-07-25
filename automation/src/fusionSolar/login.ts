import type { Page } from "playwright";

import { FusionSolarBrowserStepError } from "./navigation";
import { capture } from "./screenshots";
import { Selectors } from "./selectors";

const LOGIN_URL = "https://eu5.fusionsolar.huawei.com/unisso/login.action";
const LOGIN_STEP = "login";

export type FusionSolarCredentials = {
  username: string;
  password: string;
};

/**
 * Reads FUSIONSOLAR_ATLANTA_USERNAME / FUSIONSOLAR_ATLANTA_PASSWORD.
 * Never returns, logs, or includes the values in any error message -
 * only whether both are present.
 */
export function getFusionSolarAtlantaCredentials(): FusionSolarCredentials {
  const username = process.env.FUSIONSOLAR_ATLANTA_USERNAME;
  const password = process.env.FUSIONSOLAR_ATLANTA_PASSWORD;

  if (!username || !password) {
    throw new Error(
      "FUSIONSOLAR_ATLANTA_USERNAME and FUSIONSOLAR_ATLANTA_PASSWORD must both be set",
    );
  }

  return { username, password };
}

/**
 * FusionSolar's username field is plain text (unmasked, unlike the
 * password field). A failure screenshot taken while it still holds the
 * real value would put a credential in an image file on disk - clear it
 * first so that can never happen.
 */
async function clearUsernameFieldBeforeScreenshot(page: Page): Promise<void> {
  await page.locator(Selectors.login.usernameField).fill("").catch(() => {});
}

/**
 * Logs into FusionSolar (credentials read from environment variables -
 * see getFusionSolarAtlantaCredentials) and waits until the authenticated
 * application shell has actually loaded, not just the SSO redirect,
 * before returning the same page. Throws FusionSolarBrowserStepError
 * (screenshot, URL, page title, step name, selector) if login is
 * rejected or never completes.
 *
 * Does not use the shared runFusionSolarStep helper (see navigation.ts):
 * unlike every other step in this module, a login failure screenshot can
 * expose the plaintext username still sitting in the field, so this
 * function clears that field before capturing one.
 */
export async function login(page: Page): Promise<Page> {
  const credentials = getFusionSolarAtlantaCredentials();

  try {
    await page.goto(LOGIN_URL, { waitUntil: "networkidle" });

    await page.locator(Selectors.login.usernameField).waitFor({ state: "visible" });
    await page.locator(Selectors.login.usernameField).fill(credentials.username);
    await page.locator(Selectors.login.passwordField).fill(credentials.password);
    await page.locator(Selectors.login.loginButton).click();

    // Race the two possible outcomes of submitting the form: either the
    // SSO redirect navigates away from the login page, or FusionSolar
    // renders an error message. Filtered to non-empty text specifically -
    // the error container can become visible for a frame before its text
    // is populated, and treating that empty flash as a real rejection is
    // a false positive.
    await Promise.race([
      page.waitForURL((url) => !url.pathname.includes("/unisso/login"), { timeout: 20000 }),
      page
        .locator(Selectors.login.errorMessage)
        .filter({ hasText: /\S/ })
        .waitFor({ state: "visible", timeout: 20000 }),
    ]);

    const errorLocator = page.locator(Selectors.login.errorMessage).filter({ hasText: /\S/ });
    const rejected = (await errorLocator.count()) > 0;

    if (rejected) {
      const errorText = await errorLocator.innerText().catch(() => "");
      throw new Error(`FusionSolar rejected the login credentials: ${errorText.trim() || "unknown reason"}`);
    }

    if (page.url().includes("/unisso/login")) {
      throw new Error("FusionSolar login did not navigate away from the login page");
    }

    await page.waitForLoadState("networkidle");

    return page;
  } catch (error) {
    await clearUsernameFieldBeforeScreenshot(page);

    const screenshotPath = await capture(page, "error-login").catch(() => null);

    throw new FusionSolarBrowserStepError(
      `FusionSolar browser automation step "${LOGIN_STEP}" failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      {
        step: LOGIN_STEP,
        selector: Selectors.login.loginButton,
        url: page.url(),
        pageTitle: await page.title().catch(() => "unknown"),
        screenshotPath,
        cause: error,
      },
    );
  }
}
