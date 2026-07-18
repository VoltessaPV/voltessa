/**
 * Voltessa Automation — Export Decision Engine.
 *
 * `decideExportAction` is pure business logic only. It must never import
 * from `lib/fusionsolar/*` or any other vendor-specific module — it knows
 * nothing about Huawei, FusionSolar, or any other execution backend. Its
 * only job is: given business inputs, decide what SHOULD happen. It never
 * executes anything itself and never calls
 * `lib/automation/device-execution.ts` — nothing in this milestone wires
 * this module's output to a real command.
 *
 * `evaluateExportDecision` is the one place this module is allowed to know
 * about the market-price layer: it reads the current price through the
 * Market Price Provider abstraction (`lib/market-price/provider.ts`) —
 * never ENTSO-E directly — and then calls the pure function above. It
 * stays a thin orchestrator so `decideExportAction` itself remains a
 * synchronous, dependency-free function that's trivial to reason about and
 * call directly.
 *
 * Business rule (Automation MVP milestone): the default minimum export
 * price is 15 EUR/MWh, representing the minimum profitable selling price
 * after transmission and imbalance costs. Prices below this threshold
 * should eventually trigger export limitation; prices at or above it
 * should eventually allow unrestricted export. "Eventually" — this module
 * only decides; nothing in this milestone executes that decision.
 */

import type { MarketPriceProvider } from "@/lib/market-price/provider";

export type ExportDecisionAction = "NONE" | "LIMIT_EXPORT" | "REMOVE_LIMIT";

export type ExportDecision = {
  action: ExportDecisionAction;
  reason: string;
  /** Null only when the market price was unavailable (see `evaluateExportDecision`). */
  marketPrice: number | null;
  minimumExportPrice: number;
  decisionTimestamp: Date;
};

/**
 * The plant's currently configured export mode, in the Decision Engine's
 * own vocabulary — deliberately not Huawei's (`noLimit` /
 * `zeroExportLimitation` / etc., see
 * `lib/fusionsolar/get-active-power-control-mode.ts`). Whatever eventually
 * reads the real Huawei-configured mode is responsible for translating it
 * into one of these three values before calling this function; that
 * translation does not belong here.
 */
export type ConfiguredExportMode = "UNLIMITED" | "LIMITED" | "UNKNOWN";

export type ExportDecisionInput = {
  marketPrice: number;
  minimumExportPrice: number;
  automationEnabled: boolean;
  currentConfiguredExportMode: ConfiguredExportMode;
};

/**
 * Decides what should happen to a plant's export configuration given
 * current business inputs. Does not call any API, does not persist
 * anything, does not execute anything — a pure function of its inputs
 * (the wall-clock read for `decisionTimestamp` aside).
 *
 * Extending with future rules (forecast-based, capacity-aware, etc.): add
 * further conditions here. This stays a single readable sequence of guard
 * clauses rather than a generic rule engine, per this project's
 * "simplicity beats cleverness" principle — only reach for more structure
 * if/when a second genuinely independent rule is actually added.
 */
export function decideExportAction(
  input: ExportDecisionInput,
): ExportDecision {
  const base = {
    marketPrice: input.marketPrice,
    minimumExportPrice: input.minimumExportPrice,
    decisionTimestamp: new Date(),
  };

  if (!input.automationEnabled) {
    return {
      ...base,
      action: "NONE",
      reason: "Automation is disabled for this organization.",
    };
  }

  if (input.currentConfiguredExportMode === "UNKNOWN") {
    return {
      ...base,
      action: "NONE",
      reason:
        "Current configured export mode could not be determined; taking no action.",
    };
  }

  const belowThreshold = input.marketPrice < input.minimumExportPrice;

  if (belowThreshold && input.currentConfiguredExportMode === "UNLIMITED") {
    return {
      ...base,
      action: "LIMIT_EXPORT",
      reason: `Market price (${input.marketPrice} EUR/MWh) is below the minimum export price (${input.minimumExportPrice} EUR/MWh).`,
    };
  }

  if (!belowThreshold && input.currentConfiguredExportMode === "LIMITED") {
    return {
      ...base,
      action: "REMOVE_LIMIT",
      reason: `Market price (${input.marketPrice} EUR/MWh) is at or above the minimum export price (${input.minimumExportPrice} EUR/MWh).`,
    };
  }

  return {
    ...base,
    action: "NONE",
    reason:
      "No change required — current export mode already matches the market price.",
  };
}

export type EvaluateExportDecisionInput = {
  minimumExportPrice: number;
  automationEnabled: boolean;
  currentConfiguredExportMode: ConfiguredExportMode;
  marketPriceProvider: MarketPriceProvider;
};

/**
 * Thin orchestrator: resolves the current market price through the Market
 * Price Provider abstraction, then delegates to the pure
 * `decideExportAction`. If the price is unavailable, returns a `NONE`
 * decision explaining why rather than guessing or falling back to a
 * default price. Nothing calls this yet — see module doc comment.
 */
export async function evaluateExportDecision(
  input: EvaluateExportDecisionInput,
): Promise<ExportDecision> {
  const priceResult = await input.marketPriceProvider.getCurrentPrice();

  if (!priceResult.available) {
    return {
      action: "NONE",
      reason: `Current market price unavailable (${priceResult.reason}); taking no action.`,
      marketPrice: null,
      minimumExportPrice: input.minimumExportPrice,
      decisionTimestamp: new Date(),
    };
  }

  return decideExportAction({
    marketPrice: priceResult.price.price,
    minimumExportPrice: input.minimumExportPrice,
    automationEnabled: input.automationEnabled,
    currentConfiguredExportMode: input.currentConfiguredExportMode,
  });
}
