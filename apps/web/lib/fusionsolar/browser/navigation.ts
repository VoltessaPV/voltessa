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

/**
 * Discovers the names of every direct child node under a plant (or any
 * tree node) - e.g. every Smart Dongle under a plant - by reading the
 * live tree, never by assuming a count or order. The parent must already
 * be expanded (see expandPlant). Returns an empty array if the parent
 * has no children.
 */
export async function discoverChildNodeNames(page: Page, parentName: string): Promise<string[]> {
  const selector = Selectors.tree.directChildrenList(parentName);

  return runFusionSolarStep(page, "discoverChildNodeNames", selector, async () => {
    const childList = page.locator(selector);
    await childList.waitFor({ state: "visible" });

    const nameParts = childList.locator("> li.node-line .flex-node-line-name-part");
    const count = await nameParts.count();

    const names: string[] = [];

    for (let index = 0; index < count; index += 1) {
      const title = await nameParts.nth(index).getAttribute("title");

      if (title) {
        names.push(title);
      }
    }

    return names;
  });
}

/**
 * Reads the connected/disconnected icon rendered next to a tree node's
 * name (see Selectors.tree.nodeIcon) and reports whether it indicates
 * "online". Returns null if the node (or its icon) can't be found -
 * never guesses.
 */
export async function isDongleOnline(page: Page, name: string): Promise<boolean | null> {
  const selector = Selectors.tree.nodeIcon(name);

  return runFusionSolarStep(page, "isDongleOnline", selector, async () => {
    const icon = page.locator(selector).first();

    if ((await icon.count()) === 0) {
      return null;
    }

    const src = await icon.getAttribute("src");

    return src ? src.endsWith("-connected.png") : null;
  });
}

/**
 * Opens the currently-selected device's own Configuration tab
 * ("Конфигурация" - see Selectors.deviceConfig) and waits for its
 * Active Power Control section to render, since that section loads via
 * a later async fetch than the fields above it - waiting for it is what
 * makes "fully loaded" deterministic instead of a fixed sleep.
 * Navigation only - opening this tab does not itself change or save
 * anything. Distinct from openConfiguration above, which opens a
 * different, plant-level tab with a similarly-worded title.
 */
export async function openDeviceConfiguration(page: Page): Promise<void> {
  const tabSelector = Selectors.monitorTabs.byTitle(Selectors.deviceConfig.configurationTabTitle);

  await runFusionSolarStep(page, "openDeviceConfiguration", tabSelector, async () => {
    await page.locator(tabSelector).click();
    await page.waitForLoadState("networkidle");

    const activePowerControlField = page.locator(
      Selectors.deviceConfig.fieldContainerByLabel(Selectors.deviceConfig.activePowerControlModeLabel),
    );

    await activePowerControlField.waitFor({ state: "visible", timeout: 30000 });
  });
}

/**
 * Reads a labeled field's current value from a device's Configuration
 * tab (see Selectors.deviceConfig) - works for both dropdown
 * (.ant-select-selection-item) and plain text (input.ant-input) fields,
 * since both expose their current value as a `title` attribute. Returns
 * null if the field isn't present for this device - never guesses.
 */
export async function readDeviceConfigField(page: Page, label: string): Promise<string | null> {
  const selector = Selectors.deviceConfig.fieldContainerByLabel(label);

  return runFusionSolarStep(page, "readDeviceConfigField", selector, async () => {
    const container = page.locator(selector).first();

    if ((await container.count()) === 0) {
      return null;
    }

    const selectValue = container.locator(Selectors.deviceConfig.selectValue).first();

    if ((await selectValue.count()) > 0) {
      const title = await selectValue.getAttribute("title");
      return title ?? (await selectValue.innerText().catch(() => null));
    }

    const inputValue = container.locator(Selectors.deviceConfig.inputValue).first();

    if ((await inputValue.count()) > 0) {
      return await inputValue.getAttribute("value");
    }

    return null;
  });
}
