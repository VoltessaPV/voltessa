/**
 * Voltessa Automation — Market Price Optimization Decision Engine.
 *
 * `decideExportAction` is pure business logic only: given a current price,
 * the next market interval's price (if known), a configured threshold, and
 * the plant's last known export mode, it decides what SHOULD happen. It
 * never calls the Automation Service, never reads the database, never
 * imports from `lib/fusionsolar/*` or anything vendor-specific — a
 * synchronous, dependency-free function that's trivial to reason about and
 * test directly. Whatever calls it (see
 * `lib/automation/market-price-optimization-scheduler.ts`) owns actually
 * executing the decision and recording the outcome.
 *
 * This supersedes an earlier placeholder version of this module (a simple
 * binary threshold, `UNLIMITED`/`LIMITED`/`UNKNOWN` vocabulary, explicitly
 * documented as unwired to anything) — the Market Price Optimization
 * Execution Engine milestone is that real implementation. `ExportMode` now
 * uses the Automation Service's own canonical vocabulary directly
 * ("Zero Export" / "No Limit") rather than a third, translated vocabulary.
 *
 * Business rule: a single fixed threshold flipping a plant's export mode
 * exactly at that price would oscillate on every small price fluctuation
 * around it. A ±5 EUR/MWh hysteresis band (LOW BAND = threshold - 5,
 * HIGH BAND = threshold + 5) avoids that: only prices at or beyond a band
 * edge act immediately, while prices inside the band only act if the next
 * market interval's forecast agrees with the move. The band width is an
 * internal implementation detail — never exposed in the UI, never
 * configured by the user, only the threshold itself is.
 */

export type ExportMode = "Zero Export" | "No Limit";

export type ExportDecisionAction =
  | "NONE"
  | "SWITCH_TO_ZERO_EXPORT"
  | "SWITCH_TO_NO_LIMIT";

/**
 * Full Internationalization milestone: a stable, canonical code — never
 * English prose — so the backend stays language-independent (per the
 * approved architecture: "no translated database values, database stores
 * canonical values, localization belongs exclusively to the presentation
 * layer"). Translated at render/notification time via
 * `lib/automation/automation-event-i18n.ts`, from `automations.json`'s
 * `decisionReasons.*` keys (same code, both places — keep them in sync).
 * Previously this field held literal English sentences directly; that was
 * a real violation this milestone fixed (see `AutomationEvent.reason`'s
 * schema comment).
 */
export type ExportDecisionReasonCode =
  | "already_zero_export_low_band"
  | "price_below_low_band"
  | "already_no_limit_high_band"
  | "price_above_high_band"
  | "already_zero_export_below_threshold"
  | "forecast_indicates_decline"
  | "below_threshold_no_decline_forecast"
  | "already_no_limit_above_threshold"
  | "forecast_indicates_recovery"
  | "above_threshold_no_recovery_forecast";

export type ExportDecision = {
  action: ExportDecisionAction;
  reason: ExportDecisionReasonCode;
  currentPrice: number;
  nextIntervalPrice: number | null;
  threshold: number;
  lowBand: number;
  highBand: number;
};

/** Internal implementation detail — never exposed in the UI. */
export const HYSTERESIS_BAND_EUR_PER_MWH = 5;

export type DecideExportActionInput = {
  currentPrice: number;
  /** Null when the next interval's price hasn't been persisted yet. */
  nextIntervalPrice: number | null;
  threshold: number;
  /** Null only before this organization's very first execution/reconciliation. */
  currentMode: ExportMode | null;
};

/**
 * Decides what should happen to a plant's export configuration given
 * current business inputs. Does not call any API, does not persist
 * anything, does not execute anything.
 *
 * The four cases below partition the real line with no gaps or overlaps:
 * (-inf, lowBand] = Case 1, (lowBand, threshold) = Case 3,
 * [threshold, highBand) = Case 4, [highBand, +inf) = Case 2.
 */
export function decideExportAction(
  input: DecideExportActionInput,
): ExportDecision {
  const { currentPrice, nextIntervalPrice, threshold, currentMode } = input;
  const lowBand = threshold - HYSTERESIS_BAND_EUR_PER_MWH;
  const highBand = threshold + HYSTERESIS_BAND_EUR_PER_MWH;

  const base = { currentPrice, nextIntervalPrice, threshold, lowBand, highBand };

  // Case 1: price at or below the low band.
  if (currentPrice <= lowBand) {
    if (currentMode === "Zero Export") {
      return { ...base, action: "NONE", reason: "already_zero_export_low_band" };
    }

    return { ...base, action: "SWITCH_TO_ZERO_EXPORT", reason: "price_below_low_band" };
  }

  // Case 2: price at or above the high band.
  if (currentPrice >= highBand) {
    if (currentMode === "No Limit") {
      return { ...base, action: "NONE", reason: "already_no_limit_high_band" };
    }

    return { ...base, action: "SWITCH_TO_NO_LIMIT", reason: "price_above_high_band" };
  }

  // Case 3: strictly between the low band and the threshold.
  if (currentPrice < threshold) {
    if (currentMode === "Zero Export") {
      return { ...base, action: "NONE", reason: "already_zero_export_below_threshold" };
    }

    if (nextIntervalPrice !== null && nextIntervalPrice < threshold) {
      return { ...base, action: "SWITCH_TO_ZERO_EXPORT", reason: "forecast_indicates_decline" };
    }

    return {
      ...base,
      action: "NONE",
      reason: "below_threshold_no_decline_forecast",
    };
  }

  // Case 4: from the threshold up to (but not including) the high band.
  if (currentMode === "No Limit") {
    return { ...base, action: "NONE", reason: "already_no_limit_above_threshold" };
  }

  if (nextIntervalPrice !== null && nextIntervalPrice > threshold) {
    return { ...base, action: "SWITCH_TO_NO_LIMIT", reason: "forecast_indicates_recovery" };
  }

  return {
    ...base,
    action: "NONE",
    reason: "above_threshold_no_recovery_forecast",
  };
}
