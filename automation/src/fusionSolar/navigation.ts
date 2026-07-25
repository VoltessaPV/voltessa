import type { Page } from "playwright";

import { capture } from "./screenshots.ts";
import { Selectors } from "./selectors.ts";

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
 *
 * Deterministic, element-level synchronization (replaces a prior
 * page.waitForLoadState("networkidle") here, confirmed live to be an
 * unreliable readiness signal for this SPA - see git history): waits
 * for the plant's own name text to exist before clicking it, then waits
 * for that plant's tree row (Selectors.tree.rowByName) to appear -
 * exactly what expandPlant, the next step in every real call site,
 * itself needs.
 */
export async function selectPlant(page: Page, name: string): Promise<void> {
  const selector = `text="${name}"`;

  await runFusionSolarStep(page, "selectPlant", selector, async () => {
    const target = page.getByText(name, { exact: true }).first();
    await target.waitFor({ state: "visible" });
    await target.click();
    await page.locator(Selectors.tree.rowByName(name)).waitFor({ state: "visible" });
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
 *
 * Deterministic, element-level synchronization (replaces a prior
 * page.waitForLoadState("networkidle") here - see selectPlant's comment
 * for why): waits for the dongle's own tree node to exist before
 * clicking it, then waits for the Configuration tab to appear on the
 * resulting device detail page - exactly what openDeviceConfiguration,
 * the next step in every real call site, itself needs to click.
 */
export async function openDongle(page: Page, name: string): Promise<void> {
  const selector = Selectors.tree.nodeByName(name);

  await runFusionSolarStep(page, "openDongle", selector, async () => {
    const target = page.locator(selector);
    await target.waitFor({ state: "visible" });
    await target.click();

    const configTabSelector = Selectors.monitorTabs.byTitle(Selectors.deviceConfig.configurationTabTitle);
    await page.locator(configTabSelector).waitFor({ state: "visible" });
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
 *
 * Deterministic, element-level synchronization throughout (a prior
 * page.waitForLoadState("networkidle") between the click and the
 * Active Power Control wait below was removed - it was fully redundant
 * with that already-existing wait, and confirmed live to be an
 * unreliable readiness signal for this SPA - see git history). Waits
 * for the Configuration tab to exist before clicking it too, so this
 * function is self-contained regardless of caller (openDongle already
 * waits for this same condition, but reopenDeviceConfigurationAndRead
 * calls this function directly, after leaving to Details, without that
 * guarantee).
 */
export async function openDeviceConfiguration(page: Page): Promise<void> {
  const tabSelector = Selectors.monitorTabs.byTitle(Selectors.deviceConfig.configurationTabTitle);

  await runFusionSolarStep(page, "openDeviceConfiguration", tabSelector, async () => {
    const tab = page.locator(tabSelector);
    await tab.waitFor({ state: "visible" });
    await tab.click();

    const activePowerControlField = page.locator(
      Selectors.deviceConfig.fieldContainerByLabel(Selectors.deviceConfig.activePowerControlModeLabel),
    );

    await activePowerControlField.waitFor({ state: "visible", timeout: 30000 });
  });
}

/**
 * Every device detail page's URL carries its own unique device id as a
 * `NE=<number>` hash-route segment (e.g.
 * `#/view/device/NE=165824328/dongle/config`) - confirmed live against
 * all three real Atlanta dongles, each with its own distinct, stable NE
 * value across repeated visits. Returns null if the URL doesn't match -
 * never guessed at for any other page shape.
 */
function extractDeviceId(url: string): string | null {
  const match = url.match(/NE=(\d+)/);
  return match ? match[1] : null;
}

/**
 * Navigates deterministically to a specific dongle's own Configuration
 * page. Always starts by returning to the plant overview - never
 * assumes anything about whatever dongle (if any) was open before, or
 * what tab/state a previous iteration left behind. Use this instead of
 * calling openDongle/openDeviceConfiguration directly when processing
 * multiple dongles in sequence, so every iteration is independent of
 * the last.
 *
 * Returns to the overview via selectPlant (the same in-app click
 * already used to reach Atlanta the very first time) - NOT via
 * page.goto(). A hard page.goto() reload was tried first and confirmed
 * live to be actively harmful: it re-triggers a cookie-consent banner
 * that the real session had already dismissed once at login, and lands
 * with the tree collapsed rather than expanded, since expand state
 * isn't preserved across a full reload. selectPlant's in-app click has
 * neither problem - the tree/session state carries over exactly as it
 * does during any other in-app navigation. expandPlant is called again
 * regardless (idempotent - a no-op if already expanded, a real click if
 * a previous full-app anomaly ever left it collapsed).
 *
 * Verification is two-layered:
 *  1. The "Подробности" (Details) tab - confirmed always present on
 *     every device detail page - must exist, proving the page landed on
 *     some device's own detail view rather than remaining on the plant
 *     overview or an error page. This alone is not treated as
 *     sufficient (it can't distinguish one device's page from another's).
 *  2. The device id (`NE=`) captured from the URL immediately after
 *     selecting the dongle (openDongle) must be identical to the device
 *     id captured from the URL after opening Configuration. Since
 *     openDongle's own click targets dongleName's tree node exactly
 *     (Selectors.tree.nodeByName, exact-match), the first NE capture is
 *     the confirmed identity of the page we just navigated to; this
 *     step confirms the Configuration tab click didn't silently land on
 *     a different device's page. If either URL has no NE id, or the two
 *     ids differ, this fails immediately rather than returning a page
 *     that might belong to the wrong dongle.
 */
export async function navigateToDongleConfiguration(
  page: Page,
  plantName: string,
  dongleName: string,
): Promise<void> {
  await selectPlant(page, plantName);
  await expandPlant(page, plantName);
  await openDongle(page, dongleName);

  const deviceIdAfterSelect = extractDeviceId(page.url());

  await openDeviceConfiguration(page);

  const detailsTabSelector = Selectors.monitorTabs.byTitle(Selectors.deviceConfig.detailsTabTitle);

  await runFusionSolarStep(page, "verifyDongleConfigurationPage", detailsTabSelector, async () => {
    const count = await page.locator(detailsTabSelector).count();

    if (count === 0) {
      throw new Error(
        `Expected "${dongleName}"'s device detail page to be open (Configuration tab) but the "Подробности" tab is missing - navigation did not land where expected`,
      );
    }

    const deviceIdAfterConfig = extractDeviceId(page.url());

    if (!deviceIdAfterSelect) {
      throw new Error(
        `Could not read a device id from the URL after selecting "${dongleName}" (${page.url()}) - cannot verify this page belongs to the requested dongle`,
      );
    }

    if (!deviceIdAfterConfig) {
      throw new Error(
        `Could not read a device id from the URL after opening Configuration for "${dongleName}" (${page.url()}) - cannot verify this page belongs to the requested dongle`,
      );
    }

    if (deviceIdAfterSelect !== deviceIdAfterConfig) {
      throw new Error(
        `Configuration page does not belong to "${dongleName}": selected device id ${deviceIdAfterSelect}, but the Configuration page shows device id ${deviceIdAfterConfig}`,
      );
    }
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
 *
 * Deterministic, element-level synchronization (a prior
 * page.waitForLoadState("networkidle") after the Details-tab click was
 * removed - see git history): no explicit wait is needed after that
 * click beyond waiting for the Details tab to exist before clicking
 * it, since openDeviceConfiguration (called next) already waits for the
 * Configuration tab to exist before clicking it - exactly the condition
 * this step's completion needs to guarantee.
 */
export async function reopenDeviceConfigurationAndRead(page: Page, label: string): Promise<string | null> {
  const detailsTabSelector = Selectors.monitorTabs.byTitle(Selectors.deviceConfig.detailsTabTitle);

  await runFusionSolarStep(page, "leaveConfigurationForReopen", detailsTabSelector, async () => {
    const tab = page.locator(detailsTabSelector);
    await tab.waitFor({ state: "visible" });
    await tab.click();
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
 * become disabled again - the earliest reliable signal, confirmed across
 * multiple real, successful saves during verification. It stays visually
 * active/pending for a while after being clicked (a Smart Dongle relays
 * the change to real hardware, which took over 20 seconds in one
 * verified run) before going back to disabled, which is what this waits
 * for - never a fixed sleep. Throws (via runFusionSolarStep, with a
 * screenshot) if it doesn't happen within the timeout.
 *
 * FusionSolar separately shows an "Операцията е успешна" (Operation
 * succeeded) info dialog once the save actually completes - see
 * dismissSaveSuccessDialog, called after this one.
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

/**
 * Waits for FusionSolar's post-Save "Operation succeeded" info dialog,
 * clicks its OK button, and waits for the modal overlay to fully close.
 * Confirmed via a live production failure (screenshot +
 * Playwright trace) that this dialog remains open after
 * waitForSaveConfirmation returns, and its overlay (an AntD
 * ant-modal-confirm-family element - Modal.info/success/confirm all
 * share that wrapper class) intercepts pointer events for whatever tries
 * to interact with the page next, hanging reopenDeviceConfigurationAndRead's
 * click on the Details tab for its full timeout. Reuses the same
 * confirmDialog/confirmDialogOkButton selectors as
 * confirmSaveDialogIfPresent (the same dialog family), but unlike that
 * step this dialog is expected to actually appear here, so this waits
 * for it rather than treating it as optional.
 */
export async function dismissSaveSuccessDialog(page: Page): Promise<void> {
  const selector = Selectors.deviceConfig.confirmDialog;

  await runFusionSolarStep(page, "dismissSaveSuccessDialog", selector, async () => {
    const dialog = page.locator(selector).first();
    await dialog.waitFor({ state: "visible" });

    const okButton = page.locator(Selectors.deviceConfig.confirmDialogOkButton).first();
    await okButton.click();

    await dialog.waitFor({ state: "hidden" });
  });
}
