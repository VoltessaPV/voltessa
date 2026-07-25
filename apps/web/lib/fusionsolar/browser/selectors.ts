/**
 * Every FusionSolar browser-automation selector lives here - no other file
 * in this module (or anywhere else in the app) should hardcode one.
 *
 * Every selector below was confirmed by directly inspecting the real,
 * live FusionSolar portal (https://eu5.fusionsolar.huawei.com) - login
 * page fields/button, an authenticated plant-tree node and its expand
 * control, and the plant-overview tab bar - not guessed at. If FusionSolar
 * changes its markup, this is the one file that needs updating.
 */
export const Selectors = {
  login: {
    /** "Потребителско име или имейл" (Username or email) input. */
    usernameField: "#username",
    /** "Парола" (Password) input. */
    passwordField: "#value",
    /** "Влизане" (Log in) button - a div (tabindex=0), not a real <button>. */
    loginButton: "#btn_outerverify",
    /** Shown (with message text) only when login is rejected. */
    errorMessage: "#errorMessage",
  },

  /**
   * The plant/device tree shown on the left of a plant's monitoring view.
   * Every node (plant, dongle, inverter, ...) shares the same markup
   * shape, matched by its exact display name via the `title` attribute
   * (FusionSolar truncates the visible node-name text with an ellipsis in
   * a narrow tree, but always sets the full name as `title`).
   */
  tree: {
    nodeByName: (name: string) => `.flex-node-line-name-part[title="${name}"]`,
    /** The row containing a node's name AND its expand arrow - the arrow
     *  is a sibling of the name element, not a descendant of it. */
    rowByName: (name: string) => `.flex-node-line:has(.flex-node-line-name-part[title="${name}"])`,
    expandControl: ".flex-node-line-expand-part",
    expandIcon: ".tree-icon",
    expandedIconLabel: "caret-down",
    collapsedIconLabel: "caret-right",
  },

  /** The tab bar shown after selecting a plant (Обзор/Overview is the
   *  default selected tab). */
  plantOverview: {
    /** "Управление на устройството" (Device Management) - where a
     *  device's configuration lives. Selector confirmed present in the
     *  live DOM; navigating into it is out of scope for Phase 1. */
    deviceManagementTab: 'span.monitor-tab[title="Управление на устройството"]',
  },
} as const;
