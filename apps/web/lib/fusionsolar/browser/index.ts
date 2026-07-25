/**
 * FusionSolar browser automation. Temporary layer until the native
 * Huawei/OpenEMS integration is complete. No configuration changes, no
 * Save, no Zero Export/No Limit - this is read-only navigation and
 * inspection only; write actions are later phases, built on top of this
 * once it's proven reliable.
 *
 * Phase 1: login, plant/device tree navigation, screenshots.
 * Phase 2: dynamic child-device discovery, a device's own Configuration
 * tab, and reading its current field values (Active Power Control mode,
 * firmware, ...).
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
  runFusionSolarStep,
  FusionSolarBrowserStepError,
} from "./navigation";
export { capture, SCREENSHOT_DIR, ensureScreenshotDirectory } from "./screenshots";
export { Selectors } from "./selectors";
