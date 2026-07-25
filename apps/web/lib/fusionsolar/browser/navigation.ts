import type { Page } from "playwright-core";

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

/**
 * Leaves the currently-open device Configuration tab (navigating to
 * "Подробности" / Details) and opens Configuration again fresh, then
 * reads a labeled field's value from that newly-opened page - a genuine
 * reload, not a re-read of the same page that was already open.
 *
 * Required after every successful Save: reading a field back from the
 * exact page that just performed the Save risks validating stale
 * client-side UI state instead of what FusionSolar actually persisted.
 * Clicking the already-active Configuration tab again would not force
 * this (antd tabs don't re-fetch on a click that doesn't change the
 * active tab) - genuinely leaving first is what makes the reload real.
 */
export async function reopenDeviceConfigurationAndRead(page: Page, label: string): Promise<string | null> {
  const detailsTabSelector = Selectors.monitorTabs.byTitle(Selectors.deviceConfig.detailsTabTitle);

  await runFusionSolarStep(page, "leaveConfigurationForReopen", detailsTabSelector, async () => {
    await page.locator(detailsTabSelector).click();
    await page.waitForLoadState("networkidle");
  });

  await openDeviceConfiguration(page);

  return readDeviceConfigField(page, label);
}

/**
 * Selects a new value in the Active Power Control mode dropdown on the
 * currently-open device Configuration page (see openDeviceConfiguration).
 * `optionText` must be one of Selectors.deviceConfig.activePowerControlMode's
 * values. This only changes the in-page form state - nothing is written
 * to the device until clickSaveButton is called. Confirmed: selecting a
 * value enables the Save button immediately, with no confirmation dialog
 * at selection time.
 */
export async function setActivePowerControlMode(page: Page, optionText: string): Promise<void> {
  const fieldSelector = Selectors.deviceConfig.fieldContainerByLabel(
    Selectors.deviceConfig.activePowerControlModeLabel,
  );

  await runFusionSolarStep(page, "setActivePowerControlMode", fieldSelector, async () => {
    const container = page.locator(fieldSelector).first();
    await container.locator(Selectors.deviceConfig.selectValue).first().click();

    const optionList = page.locator(Selectors.deviceConfig.openDropdownOptionList);
    await optionList.waitFor({ state: "visible" });

    await optionList.locator(Selectors.deviceConfig.optionByText(optionText)).first().click();

    const selectedValue = container.locator(Selectors.deviceConfig.selectValue).first();
    await selectedValue.waitFor({ state: "visible" });

    const currentTitle = await selectedValue.getAttribute("title");

    if (currentTitle !== optionText) {
      throw new Error(
        `Active Power Control mode selection did not take effect: expected "${optionText}", field now shows "${currentTitle}"`,
      );
    }
  });
}

/**
 * Clicks the Configuration page's "Запазване" (Save) button. Only call
 * this after actually changing a field (see setActivePowerControlMode) -
 * the button stays disabled otherwise, and clicking a disabled button is
 * a no-op that would silently mask a caller bug, so this throws if the
 * button is disabled rather than clicking through it.
 *
 * Does not itself wait for a success confirmation or handle a possible
 * confirmation dialog - see confirmSaveDialogIfPresent and
 * waitForSaveConfirmation, called separately so each step's failure is
 * attributed to the right one.
 */
export async function clickSaveButton(page: Page): Promise<void> {
  const selector = Selectors.deviceConfig.saveButton;

  await runFusionSolarStep(page, "clickSaveButton", selector, async () => {
    const button = page.getByRole("button", { name: selector });
    await button.waitFor({ state: "visible" });

    if (await button.isDisabled()) {
      throw new Error("Save button is disabled - no field was actually changed before calling clickSaveButton");
    }

    await button.click();
  });
}

/**
 * Handles an optional confirmation dialog that may appear immediately
 * after clicking Save, before the final success confirmation. Not
 * verified against a real save (see Selectors.deviceConfig's comment) -
 * if FusionSolar doesn't show one for this field, this is a fast no-op
 * (a short, bounded wait, not a long timeout), so it's always safe to
 * call.
 */
export async function confirmSaveDialogIfPresent(page: Page): Promise<void> {
  const selector = Selectors.deviceConfig.confirmDialog;

  await runFusionSolarStep(page, "confirmSaveDialogIfPresent", selector, async () => {
    const dialog = page.locator(selector).first();
    const appeared = await dialog
      .waitFor({ state: "visible", timeout: 3000 })
      .then(() => true)
      .catch(() => false);

    if (!appeared) {
      return;
    }

    const okButton = page.locator(Selectors.deviceConfig.confirmDialogOkButton).first();
    await okButton.click();
    await dialog.waitFor({ state: "hidden", timeout: 15000 });
  });
}

/**
 * Waits for FusionSolar's real confirmation that a Save completed, by
 * waiting for the Save button (Selectors.deviceConfig.saveButton) to
 * become disabled again. This is not a guess: no toast, message, or
 * dialog was ever observed for this field across multiple real,
 * successful saves during verification - the button itself was the
 * only confirmed signal. It stays visually active/pending for a while
 * after being clicked (a Smart Dongle relays the change to real
 * hardware, which took over 20 seconds in one verified run) before
 * going back to disabled, which is what this waits for - never a fixed
 * sleep. Throws (via runFusionSolarStep, with a screenshot) if it
 * doesn't happen within the timeout.
 */
export async function waitForSaveConfirmation(page: Page): Promise<void> {
  const buttonText = Selectors.deviceConfig.saveButton;

  await runFusionSolarStep(page, "waitForSaveConfirmation", buttonText, async () => {
    await page.waitForFunction(
      (text) => {
        const button = Array.from(document.querySelectorAll("button")).find((candidate) =>
          candidate.textContent?.includes(text),
        );

        return button ? (button as HTMLButtonElement).disabled : false;
      },
      buttonText,
      { timeout: 120000 },
    );
  });
}
