/**
 * FusionSolar browser automation. Temporary layer until the native
 * Huawei/OpenEMS integration is complete.
 *
 * Phase 1: login, plant/device tree navigation, screenshots.
 * Phase 2: dynamic child-device discovery, a device's own Configuration
 * tab, and reading its current field values (Active Power Control mode,
 * firmware, ...) - read-only.
 * Phase 3: changing a device's Active Power Control mode and saving it -
 * the only write-capable part of this module. Used exclusively by the
 * Atlanta-only debug console (app/dev/fusionsolar_atlanta) - nothing
 * else in the app calls setActivePowerControlMode/clickSaveButton.
 */
export { launchBrowserSession, closeBrowserSession, type FusionSolarBrowserSession } from "./browser";
export { login, getFusionSolarAtlantaCredentials, type FusionSolarCredentials } from "./login";
export {
  selectPlant,
  expandPlant,
  openDongle,
  openConfiguration,
  discoverChildNodeNames,
  isDongleOnline,
  openDeviceConfiguration,
  readDeviceConfigField,
  reopenDeviceConfigurationAndRead,
  setActivePowerControlMode,
  clickSaveButton,
  confirmSaveDialogIfPresent,
  waitForSaveConfirmation,
  runFusionSolarStep,
  FusionSolarBrowserStepError,
} from "./navigation";
export { capture, SCREENSHOT_DIR, ensureScreenshotDirectory } from "./screenshots";
export { Selectors } from "./selectors";
