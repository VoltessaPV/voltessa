/**
 * Full Internationalization milestone. The one place `AutomationEvent`'s
 * stored `summary`/`reason` (English audit text — see those fields' own
 * schema comments for why they're no longer re-displayed directly) get
 * regenerated into real, locale-aware display text from structured fields
 * instead. Callers pass in whatever translator they have — `getTranslations`
 * (request-scoped, for the Market page) or `createTranslator` (explicit
 * locale, for the ntfy notification path, which has no per-notification
 * recipient locale and stays English by deliberate, documented choice — see
 * `lib/notifications/automation-notifications.ts`).
 */
type Translator = (key: string, values?: Record<string, string>) => string;

export type AutomationEventSummaryInput = {
  type: string;
  newMode: string | null;
};

/** `t` scoped to `automations.eventLog`; `tTerm` scoped to `terminology`. */
export function translateAutomationEventSummary(
  t: Translator,
  tTerm: Translator,
  input: AutomationEventSummaryInput,
): string {
  if (input.type === "mode_changed" && input.newMode) {
    const modeLabel = input.newMode === "Zero Export" ? tTerm("zeroExport") : tTerm("noLimit");
    return t("modeChangedSummary", { mode: modeLabel });
  }

  if (input.type === "automation_service_failed") {
    return t("automationServiceFailedSummary");
  }

  return "";
}

/**
 * `t` scoped to `automations.eventLog.decisionReasons`; `tTerm` scoped to
 * `terminology`. Only meaningful for `mode_changed` events — a reason
 * code from `ExportDecisionReasonCode` (`lib/automation/export-decision.ts`).
 * `automation_service_failed`/reconciliation reasons stay raw diagnostic
 * text, out of this fix's scope (see `AutomationEvent.reason`'s schema
 * comment) — callers should fall back to the stored value for those types.
 */
export function translateDecisionReason(t: Translator, tTerm: Translator, reasonCode: string): string {
  return t(reasonCode, { zeroExport: tTerm("zeroExport"), noLimit: tTerm("noLimit") });
}
