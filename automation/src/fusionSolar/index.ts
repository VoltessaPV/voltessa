/**
 * FusionSolar browser automation for the Atlanta plant. Moved here
 * unchanged from apps/web/lib/fusionsolar/browser (see git history for
 * that module's own Phase 1/2/3 record) - this service is now the only
 * place that launches Playwright or knows anything about FusionSolar's
 * portal markup.
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
