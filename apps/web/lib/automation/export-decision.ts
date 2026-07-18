/**
 * Voltessa Automation — Export Decision Engine.
 *
 * Pure business logic only. This module must never import from
 * `lib/fusionsolar/*` or any other vendor-specific module — it knows
 * nothing about Huawei, FusionSolar, or any other execution backend. Its
 * only job is: given business inputs, decide what SHOULD happen. It never
 * executes anything itself and never calls
 * `lib/automation/device-execution.ts` — nothing in this milestone wires
 * this module's output to a real command.
 *
 * Business rule (Automation MVP milestone): the default minimum export
 * price is 15 EUR/MWh, representing the minimum profitable selling price
 * after transmission and imbalance costs. Prices below this threshold
 * should eventually trigger export limitation; prices at or above it
 * should eventually allow unrestricted export. "Eventually" — this module
 * only decides; nothing in this milestone executes that decision.
 */

export type ExportDecisionAction = "NONE" | "LIMIT_EXPORT" | "REMOVE_LIMIT";

export type ExportDecision = {
  action: ExportDecisionAction;
  reason: string;
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
 * anything, does not execute anything — a pure function of its inputs.
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
  if (!input.automationEnabled) {
    return {
      action: "NONE",
      reason: "Automation is disabled for this organization.",
    };
  }

  if (input.currentConfiguredExportMode === "UNKNOWN") {
    return {
      action: "NONE",
      reason:
        "Current configured export mode could not be determined; taking no action.",
    };
  }

  const belowThreshold = input.marketPrice < input.minimumExportPrice;

  if (belowThreshold && input.currentConfiguredExportMode === "UNLIMITED") {
    return {
      action: "LIMIT_EXPORT",
      reason: `Market price (${input.marketPrice} EUR/MWh) is below the minimum export price (${input.minimumExportPrice} EUR/MWh).`,
    };
  }

  if (!belowThreshold && input.currentConfiguredExportMode === "LIMITED") {
    return {
      action: "REMOVE_LIMIT",
      reason: `Market price (${input.marketPrice} EUR/MWh) is at or above the minimum export price (${input.minimumExportPrice} EUR/MWh).`,
    };
  }

  return {
    action: "NONE",
    reason:
      "No change required — current export mode already matches the market price.",
  };
}
