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
 * Exactly `ExportDecisionReasonCode`'s own literal values
 * (`lib/automation/export-decision.ts`) — duplicated here (not imported)
 * so this presentation-layer module stays free of a dependency on the
 * automation domain's types, matching this file's existing "plain string
 * union" convention. Used only to detect a reason value this translation
 * layer actually knows how to render — see `translateDecisionReason`.
 */
const KNOWN_REASON_CODES = new Set([
  "already_zero_export_low_band",
  "price_below_low_band",
  "already_no_limit_high_band",
  "price_above_high_band",
  "already_zero_export_below_threshold",
  "forecast_indicates_decline",
  "below_threshold_no_decline_forecast",
  "already_no_limit_above_threshold",
  "forecast_indicates_recovery",
  "above_threshold_no_recovery_forecast",
]);

/**
 * `t` scoped to `automations.eventLog.decisionReasons`; `tTerm` scoped to
 * `terminology`. Only meaningful for `mode_changed` events — a reason
 * code from `ExportDecisionReasonCode` (`lib/automation/export-decision.ts`).
 * `automation_service_failed`/reconciliation reasons stay raw diagnostic
 * text, out of this fix's scope (see `AutomationEvent.reason`'s schema
 * comment) — callers should fall back to the stored value for those types.
 *
 * `reasonCode` isn't always actually a code: rows written before the
 * Full Internationalization milestone's backend fix stored literal English
 * sentences directly (see `ExportDecisionReasonCode`'s own doc comment for
 * why that was a violation this milestone fixed) - those legacy rows still
 * exist in production and would otherwise throw next-intl's own
 * `MISSING_MESSAGE` for an unrecognized key. A value outside the known
 * code set falls back to itself, unchanged - the exact same "raw stored
 * text" behavior already used for automation_service_failed/reconciliation
 * reasons, just extended to a `mode_changed` event whose data predates
 * this fix, rather than a hard error on real production history.
 */
export function translateDecisionReason(t: Translator, tTerm: Translator, reasonCode: string): string {
  if (!KNOWN_REASON_CODES.has(reasonCode)) {
    return reasonCode;
  }

  return t(reasonCode, { zeroExport: tTerm("zeroExport"), noLimit: tTerm("noLimit") });
}
