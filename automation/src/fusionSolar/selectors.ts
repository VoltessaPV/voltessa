/**
 * Every FusionSolar browser-automation selector lives here - no other file
 * in this module (or anywhere else in this service) should hardcode one.
 *
 * Every selector below was confirmed by directly inspecting the real,
 * live FusionSolar portal (https://eu5.fusionsolar.huawei.com) - login
 * page fields/button, an authenticated plant-tree node and its expand
 * control, and the plant-overview tab bar - not guessed at. If FusionSolar
 * changes its markup, this is the one file that needs updating.
 *
 * Every text value below (tab titles, field labels, dropdown option
 * text) is Bulgarian, and FusionSolar picks its rendering language from
 * the browser's own Accept-Language rather than a fixed per-account
 * setting - confirmed the hard way, when a run without an explicit
 * locale rendered the whole UI in English instead and broke every one
 * of these. browser.ts pins the browser context's locale to "bg-BG" for
 * exactly this reason; don't remove that pin without updating every
 * text value here to match.
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
    /** The <ul> holding a node's direct children - nested inside the
     *  node's own <li> (after its .flex-node-line label div), not a
     *  sibling of it. `:has(> ...)` (direct child only) on the way in is
     *  required: without it, `:has()` also matches every ANCESTOR li,
     *  since a nested node's label is a transitive descendant of each of
     *  its ancestors' <li> too - confirmed against the live tree, where
     *  the naive (descendant-only) version matched both the intended
     *  node and its parent. Used to discover child device names (e.g.
     *  every dongle under a plant) without assuming how many there are
     *  or in what order. */
    directChildrenList: (parentName: string) =>
      `li.node-line:has(> div.flex-node-line > div.flex-node-line-name-part[title="${parentName}"]) > ul`,
    /** The small connected/disconnected icon rendered next to a node's
     *  name - the only per-device online/offline signal found in the
     *  tree (confirmed present for online devices as
     *  ".../<code>-connected.png"; the offline filename convention was
     *  never observed against a real offline device during
     *  verification, since every device on the inspected plant was
     *  online). */
    nodeIcon: (name: string) => `.flex-node-line-name-part[title="${name}"] .node-icon img`,
  },

  /** The tab bar shown after selecting a plant (Обзор/Overview is the
   *  default selected tab) - and, identically shaped, the tab bar shown
   *  on a single device's detail page (Подробности/Управление на
   *  устройството/.../Конфигурация). Both are `span.monitor-tab[title]`,
   *  just with a different, page-specific set of tabs. */
  monitorTabs: {
    byTitle: (title: string) => `span.monitor-tab[title="${title}"]`,
  },

  /** The tab bar shown after selecting a plant (Обзор/Overview is the
   *  default selected tab). */
  plantOverview: {
    /** "Управление на устройството" (Device Management) - where a
     *  device's configuration lives. Selector confirmed present in the
     *  live DOM; navigating into it is out of scope for Phase 1. */
    deviceManagementTab: 'span.monitor-tab[title="Управление на устройството"]',
  },

  /**
   * A single device's (e.g. a Smart Dongle's) Configuration tab
   * (`span.monitor-tab[title="Конфигурация"]`, see monitorTabs.byTitle) -
   * distinct from plantOverview.deviceManagementTab, which is a
   * plant-level tab with a similar name but different content. Every
   * field on this page shares the same markup shape: a
   * `div[id^="signal-config-form-item-"]` wrapping both a
   * `.signal-config-signal-name` label and, depending on the field's
   * type, either an `.ant-select-selection-item` (dropdown) or an
   * `input.ant-input` (plain text) holding the current value - both
   * expose that value as their own `title` attribute.
   */
  deviceConfig: {
    configurationTabTitle: "Конфигурация",
    /** "Подробности" (Details) - the first/default tab on every device
     *  detail page, always present. Used only to navigate away from
     *  Configuration and back, forcing a genuine reload of its data
     *  instead of re-reading the still-open page after a Save. */
    detailsTabTitle: "Подробности",
    fieldContainerByLabel: (label: string) =>
      `div[id^="signal-config-form-item-"]:has(.signal-config-signal-name:has-text("${label}"))`,
    selectValue: ".ant-select-selection-item",
    inputValue: "input.ant-input",
    /** Field labels confirmed present on a Smart Dongle's Configuration
     *  page, under the "Управление на активната мощност" (Active Power
     *  Control) and "Информация за устройството" (Device Information)
     *  groups respectively. No distinctly-labeled "export limit"/"active
     *  power limit" field was found on the real page during
     *  verification - the closest candidates (a ramp-rate threshold and
     *  a fault-protection percentage) don't mean the same thing, so
     *  they are not reported as if they did. */
    activePowerControlModeLabel: "Режим на управление на активна мощност",
    firmwareVersionLabel: "Версия на софтуера",
    /** The literal option text FusionSolar renders in the Active Power
     *  Control dropdown for each mode - confirmed by opening the real
     *  dropdown (without selecting anything) during verification. Only
     *  the two modes this debug console can set are named here; the
     *  dropdown has other options (a fixed kW limit, a fixed % limit, a
     *  digital-input schedule) that are out of scope. */
    activePowerControlMode: {
      noLimit: "Неограничено",
      zeroExport: "Мрежа, свързана с нулева мощност",
    },
    /** An open (not yet selected) dropdown's option list. Scope a click
     *  to `optionByText` inside this, never to the whole page - a
     *  hidden, previously-opened dropdown can remain in the DOM. */
    openDropdownOptionList: ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
    optionByText: (text: string) => `.ant-select-item-option:has-text("${text}")`,
    /**
     * "Запазване" (Save) - a real <button>. Two confirmed, distinct
     * behaviors of its disabled state:
     *  - Disabled until some field's value has actually changed; NOT
     *    re-disabled by reverting a changed field back to its original
     *    value (antd tracks "touched", not "differs from original") -
     *    never treat "disabled" as proof nothing changed.
     *  - Once a real Save is clicked, stays visually active/pending
     *    (confirmed: still showing a loading state past 20s in one real
     *    run) until the change has actually round-tripped to the device
     *    - a Smart Dongle relays this to real hardware, which can
     *      genuinely take over a minute - and only THEN goes back to
     *      disabled. This transition (enabled -> disabled again) is the
     *      confirmed, reliable "save completed" signal this module
     *      waits on; no toast/message/dialog was ever observed
     *      appearing for this field across multiple real, successful
     *      saves during verification, despite antd being used
     *      throughout the rest of the app.
     */
    saveButton: "Запазване",
    /**
     * No confirmation dialog was observed for this field across
     * multiple real saves during verification - kept only as a
     * defensive, fast (short timeout), harmless no-op in case a
     * different field ever shows one.
     */
    confirmDialog: ".ant-modal-confirm, .ant-modal",
    confirmDialogOkButton: ".ant-modal-confirm-btns .ant-btn-primary, .ant-modal-footer .ant-btn-primary",
  },
} as const;
