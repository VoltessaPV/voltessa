import type { Page } from "playwright";

import { capture } from "./screenshots";
import { Selectors } from "./selectors";

/**
 * Thrown by any FusionSolar browser-automation step (login or
 * navigation) that fails. Always carries a screenshot taken at the
 * moment of failure, the URL/page title at that moment, the step name,
 * and the selector that was being used - everything needed to diagnose
 * a failure without re-running the automation.
 */
export class FusionSolarBrowserStepError extends Error {
  readonly step: string;
  readonly selector: string;
  readonly url: string;
  readonly pageTitle: string;
  readonly screenshotPath: string | null;

  constructor(
    message: string,
    options: {
      step: string;
      selector: string;
      url: string;
      pageTitle: string;
      screenshotPath: string | null;
      cause?: unknown;
    },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "FusionSolarBrowserStepError";
    this.step = options.step;
    this.selector = options.selector;
    this.url = options.url;
    this.pageTitle = options.pageTitle;
    this.screenshotPath = options.screenshotPath;
  }
}

/**
 * Runs one automation step, capturing a screenshot and throwing a
 * FusionSolarBrowserStepError (step name, selector, URL, page title,
 * screenshot path) if it fails - shared by every step in this module
 * (including login) so every failure is diagnosable the same way.
 */
export async function runFusionSolarStep<T>(
  page: Page,
  step: string,
  selector: string,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    const screenshotPath = await capture(page, `error-${step}`).catch(() => null);

    throw new FusionSolarBrowserStepError(
      `FusionSolar browser automation step "${step}" failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      {
        step,
        selector,
        url: page.url(),
        pageTitle: await page.title().catch(() => "unknown"),
        screenshotPath,
        cause: error,
      },
    );
  }
}

/**
 * Selects a plant by name from the plant list (Home page). Navigation
 * only - reads the plant's overview, changes nothing.
 */
export async function selectPlant(page: Page, name: string): Promise<void> {
  const selector = `text="${name}"`;

  await runFusionSolarStep(page, "selectPlant", selector, async () => {
    await page.getByText(name, { exact: true }).first().click();
    await page.waitForLoadState("networkidle");
  });
}

/**
 * Expands a plant (or any tree node) by name in the plant/device tree,
 * revealing its children. Idempotent - does nothing if already expanded.
 */
export async function expandPlant(page: Page, name: string): Promise<void> {
  const rowSelector = Selectors.tree.rowByName(name);

  await runFusionSolarStep(page, "expandPlant", rowSelector, async () => {
    const row = page.locator(rowSelector);
    await row.waitFor({ state: "visible" });

    const expandedIcon = row.locator(
      `${Selectors.tree.expandIcon}[aria-label="${Selectors.tree.expandedIconLabel}"]`,
    );

    if ((await expandedIcon.count()) > 0) {
      return;
    }

    await row.locator(Selectors.tree.expandControl).click();
    await expandedIcon.waitFor({ state: "visible" });
  });
}

/**
 * Opens a dongle (or any device tree node) by name, navigating to its
 * detail view. Navigation only - changes nothing.
 */
export async function openDongle(page: Page, name: string): Promise<void> {
  const selector = Selectors.tree.nodeByName(name);

  await runFusionSolarStep(page, "openDongle", selector, async () => {
    await page.locator(selector).click();
    await page.waitForLoadState("networkidle");
  });
}

/**
 * Navigates to the currently-selected device's Configuration ("Управление
 * на устройството" / Device Management) tab. Navigation only - opening
 * this tab does not itself change or save anything; no later step in
 * Phase 1 calls this.
 */
export async function openConfiguration(page: Page): Promise<void> {
  const selector = Selectors.plantOverview.deviceManagementTab;

  await runFusionSolarStep(page, "openConfiguration", selector, async () => {
    await page.locator(selector).click();
    await page.waitForLoadState("networkidle");
  });
}
