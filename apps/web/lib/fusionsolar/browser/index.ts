/**
 * FusionSolar browser automation (Phase 1: read-only navigation
 * foundation). Temporary layer until the native Huawei/OpenEMS
 * integration is complete - login, plant/device tree navigation, and
 * screenshots only. No configuration changes, no Save, no Zero Export -
 * those are later phases, built on top of this once it's proven reliable.
 */
export { launchBrowserSession, closeBrowserSession, type FusionSolarBrowserSession } from "./browser";
export { login, getFusionSolarAtlantaCredentials, type FusionSolarCredentials } from "./login";
export {
  selectPlant,
  expandPlant,
  openDongle,
  openConfiguration,
  runFusionSolarStep,
  FusionSolarBrowserStepError,
} from "./navigation";
export { capture } from "./screenshots";
export { Selectors } from "./selectors";
