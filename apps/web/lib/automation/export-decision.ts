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

export type ExportDecision = {
  action: ExportDecisionAction;
  reason: string;
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
      return { ...base, action: "NONE", reason: "Already Zero Export; price at or below low band." };
    }

    return { ...base, action: "SWITCH_TO_ZERO_EXPORT", reason: "Price below low band" };
  }

  // Case 2: price at or above the high band.
  if (currentPrice >= highBand) {
    if (currentMode === "No Limit") {
      return { ...base, action: "NONE", reason: "Already No Limit; price at or above high band." };
    }

    return { ...base, action: "SWITCH_TO_NO_LIMIT", reason: "Price above high band" };
  }

  // Case 3: strictly between the low band and the threshold.
  if (currentPrice < threshold) {
    if (currentMode === "Zero Export") {
      return { ...base, action: "NONE", reason: "Already Zero Export; price between low band and threshold." };
    }

    if (nextIntervalPrice !== null && nextIntervalPrice < threshold) {
      return { ...base, action: "SWITCH_TO_ZERO_EXPORT", reason: "Forecast indicates further price decline" };
    }

    return {
      ...base,
      action: "NONE",
      reason: "Price between low band and threshold; forecast does not indicate further decline.",
    };
  }

  // Case 4: from the threshold up to (but not including) the high band.
  if (currentMode === "No Limit") {
    return { ...base, action: "NONE", reason: "Already No Limit; price between threshold and high band." };
  }

  if (nextIntervalPrice !== null && nextIntervalPrice > threshold) {
    return { ...base, action: "SWITCH_TO_NO_LIMIT", reason: "Forecast indicates market recovery" };
  }

  return {
    ...base,
    action: "NONE",
    reason: "Price between threshold and high band; forecast does not indicate recovery.",
  };
}
