/**
 * FusionSolar browser automation for the Atlanta plant. Moved here
 * unchanged from apps/web/lib/fusionsolar/browser (see git history for
 * that module's own Phase 1/2/3 record) - this service is now the only
 * place that launches Playwright or knows anything about FusionSolar's
 * portal markup.
 */
export { launchBrowserSession, closeBrowserSession, type FusionSolarBrowserSession } from "./browser.ts";
export { login, getFusionSolarAtlantaCredentials, type FusionSolarCredentials } from "./login.ts";
export {
  selectPlant,
  expandPlant,
  openDongle,
  openConfiguration,
  discoverChildNodeNames,
  isDongleOnline,
  openDeviceConfiguration,
  navigateToDongleConfiguration,
  readDeviceConfigField,
  reopenDeviceConfigurationAndRead,
  setActivePowerControlMode,
  clickSaveButton,
  confirmSaveDialogIfPresent,
  waitForSaveConfirmation,
  dismissSaveSuccessDialog,
  runFusionSolarStep,
  FusionSolarBrowserStepError,
} from "./navigation.ts";
export { capture, SCREENSHOT_DIR, ensureScreenshotDirectory } from "./screenshots.ts";
export { Selectors } from "./selectors.ts";
