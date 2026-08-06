import type { MarketPricePoint } from "@/app/[locale]/(platform)/market/market-data";
import type { AvailablePvInterval } from "@/lib/digital-twin/available-pv-reconstruction";

/**
 * Battery Simulation milestone - the Battery Dispatch Engine.
 *
 * Prior art researched before writing this (OpenEMS, NREL REopt, oemof,
 * PyPSA) - what's reused from the established approach, and what's
 * deliberately left out for this codebase's actual scope:
 *
 * REUSED (established, not invented here):
 * - The storage state-of-charge transition equation itself -
 *   `SOC[t] = SOC[t-1] + charge×ηcharge - discharge/ηdischarge`, bounded by
 *   [minSoc, maxSoc] and charge/discharge power limits - is the same
 *   formulation PyPSA's and oemof's `GenericStorage`/`StorageUnit`
 *   components use for LP/MILP-based dispatch. We solve the identical
 *   physical model with Dynamic Programming instead of an LP/MILP solver
 *   (see "INTENTIONALLY OMITTED" below for why), but the model being
 *   solved is the standard one, not a bespoke one.
 * - Symmetric round-trip efficiency split, `ηcharge = ηdischarge =
 *   √ηroundTrip` - a standard, established convention (also the one
 *   requested for this milestone), and the same one PyPSA/oemof expose as
 *   a configurable option alongside independent per-leg efficiencies.
 * - A bounded/cyclic terminal SOC constraint to stop a finite-horizon
 *   optimizer from artificially draining a battery on its last step simply
 *   because no future exists to hold value for - this is exactly what
 *   PyPSA's `cyclic_state_of_charge` option (and oemof's equivalent
 *   "balanced" storage content option) exists to prevent. We don't use a
 *   literal cyclic equality constraint (see below); a DP terminal value
 *   function achieves the same intent natively.
 * - Perfect-foresight, offline dispatch over a known historical price/PV
 *   profile - exactly PyPSA/oemof's own "dispatch model" mode (as opposed
 *   to their capacity-expansion mode, which optimizes equipment sizing
 *   too - not used here; the battery's size is a user input, not an
 *   optimization output).
 * - The architectural separation between "what data feeds the dispatch
 *   decision" and "the dispatch decision logic itself" - this mirrors
 *   OpenEMS's own split between its forecast/Predictor components and its
 *   Controller components. It's exactly what makes this function reusable
 *   by a future forecast-driven Automation caller (Step 5): swap
 *   `AvailablePvInterval`'s source, this function does not change.
 *
 * INTENTIONALLY OMITTED (deliberately, not by oversight):
 * - No LP/MILP solver dependency. PyPSA/oemof/REopt all delegate to an
 *   external solver (CBC/GLPK/HiGHS/Gurobi, or JuMP+Cbc for REopt). Our
 *   problem has exactly one continuous state variable (SOC) and a small,
 *   bounded action set per step - the textbook case where Dynamic
 *   Programming finds the same global optimum an LP would, with zero new
 *   production dependency. REopt specifically needs MILP because it
 *   co-optimizes equipment *sizing* (integer/discrete choices) together
 *   with tariff structures that include piecewise-linear demand charges -
 *   none of which apply here.
 * - No capacity/sizing co-optimization (REopt's core purpose - "what size
 *   battery should I buy"). Out of scope: the administrator picks a size
 *   (2h/4h/custom) and this engine evaluates the financial outcome of
 *   *that* size, nothing more.
 * - No multi-asset/network topology modeling (PyPSA/oemof both model
 *   arbitrary grids of buses, lines, and multiple generators). We have
 *   exactly one plant and one battery.
 * - No tariff/demand-charge modeling (REopt-specific). Voltessa's revenue
 *   model is ENTSO-E export-price arbitrage only.
 * - No standing/self-discharge loss term, even though PyPSA/oemof both
 *   support one as an optional per-timestep percentage. Omitted per this
 *   milestone's explicit "no degradation model" scope - the state equation
 *   above has an obvious slot for it if a later milestone needs it.
 * - No real-time/receding-horizon (MPC) execution loop, which is what
 *   OpenEMS's live Controllers actually run. This engine is offline/batch
 *   (Digital Twin replay) - Step 5's future Automation reuse is explicitly
 *   scoped as later work, not built here.
 *
 * Objective: maximum financial return, not maximum self-consumption -
 * `Σ price_i × gridExchange_i` over the whole horizon, export positive,
 * import negative, using the same market price series both directions.
 * This is intentionally NOT the same number the (unchanged) Revenue Engine
 * will report afterward - that stays export-revenue-only by definition
 * (`computeExportRevenue`) - the benefit of avoided grid import shows up
 * instead in the Import/Consumption flows this engine also exposes, not
 * folded into "Revenue". See `BatteryDispatchInterval` below - every
 * physical energy flow is a first-class output field, deliberately, so
 * nothing about that decomposition is hidden or has to be guessed at by a
 * caller.
 */

export type BatteryConfig = {
  /** Nameplate battery energy capacity, kWh. */
  capacityKwh: number;
  /** e.g. 95.4 for 95.4%. */
  roundTripEfficiencyPercent: number;
  /** e.g. 10 for 10%. */
  minSocPercent: number;
  /** Fixed at 100 per spec - still a real parameter, not hardcoded inside the optimizer. */
  maxSocPercent: number;
  maxChargePowerKw: number;
  maxDischargePowerKw: number;
  /**
   * false: battery may only charge from PV surplus (availablePv − consumption).
   * true: battery may also charge from grid import, whenever doing so
   * increases total financial value - both modes are handled by the same
   * optimizer; only the reachable charge action set differs (see
   * `runBatteryDispatch`'s inner loop).
   */
  allowGridCharging: boolean;
};

/**
 * Every physical energy flow for one 15-minute interval, all mandatory -
 * these become the inputs to battery throughput/cycle-counting/degradation
 * KPIs and automation diagnostics later, and the future Digital Twin UI
 * visualizes `socKwh` directly alongside Grid Import/Export/Market Price.
 * Structurally compatible with `SettlementEnergyPoint`
 * (`intervalStart`/`exportedKwh`/`importedKwh`), so it can be passed
 * directly into the existing, unchanged `sumSettlementEnergy`/
 * `computeExportRevenue` with no adapter - TypeScript's structural typing
 * does the rest.
 */
export type BatteryDispatchInterval = {
  intervalStart: Date;
  availablePvKwh: number;
  consumptionKwh: number;
  chargeKwh: number;
  dischargeKwh: number;
  exportedKwh: number;
  importedKwh: number;
  /** State of charge at the END of this interval. State, not an energy flow - never sum or average this across a coarser view; see this file's aggregation note. */
  socKwh: number;
};

const INTERVAL_HOURS = 15 / 60;
/** Discretized SOC grid resolution - resolution scales with battery size automatically since the step is usableRangeKwh / this. */
const SOC_GRID_STATES = 200;

function validateBatteryConfig(config: BatteryConfig): void {
  if (!(config.capacityKwh > 0)) {
    throw new Error("Battery capacity must be greater than zero");
  }
  if (!(config.roundTripEfficiencyPercent > 0) || config.roundTripEfficiencyPercent > 100) {
    throw new Error("Round-trip efficiency must be between 0 and 100 percent");
  }
  if (config.minSocPercent < 0 || config.minSocPercent >= config.maxSocPercent) {
    throw new Error("Minimum SOC must be non-negative and less than maximum SOC");
  }
  if (config.maxSocPercent > 100) {
    throw new Error("Maximum SOC cannot exceed 100 percent");
  }
  if (!(config.maxChargePowerKw > 0)) {
    throw new Error("Maximum charge power must be greater than zero");
  }
  if (!(config.maxDischargePowerKw > 0)) {
    throw new Error("Maximum discharge power must be greater than zero");
  }
}

/**
 * Dynamic Programming, backward induction, over a discretized SOC grid.
 *
 * The action set at each step is "move from the current SOC grid level to
 * a reachable target grid level" (not "pick a continuous charge/discharge
 * amount and round the result") - every state the DP ever considers is
 * therefore exactly a grid point, by construction, so there is no rounding
 * drift accumulating over ~2,900 timesteps in a typical month-long replay,
 * and the terminal handling below stays numerically exact.
 *
 * Terminal handling: the battery starts the period at `minSoc` (index 0,
 * "starts empty" - a documented V1 assumption). A hard "end SOC ≥ start
 * SOC" constraint would be trivially satisfied here (index 0 is the floor
 * of the whole state space) and would not actually prevent an
 * artificial end-of-horizon drain - the real fix is a terminal VALUE
 * function that prices any leftover SOC at the period's mean known price
 * (deterministic, reproducible) rather than at zero. A zero terminal value
 * is what would cause the pathology (the optimizer selling any leftover
 * energy for whatever it can get on the last step, since "worthless" is
 * beaten by any positive price); pricing it at a representative reference
 * value removes that incentive without a literal start/end equality
 * constraint - equivalent in intent to PyPSA's `cyclic_state_of_charge`,
 * implemented natively for a backward-induction DP instead.
 */
export function runBatteryDispatch(
  intervals: AvailablePvInterval[],
  capacityFactor: number,
  priceSeries: MarketPricePoint[],
  config: BatteryConfig,
): BatteryDispatchInterval[] {
  validateBatteryConfig(config);

  const T = intervals.length;
  if (T === 0) {
    return [];
  }

  const priceByTime = new Map(priceSeries.map((p) => [p.timestamp.getTime(), p.price]));

  const minSocKwh = (config.minSocPercent / 100) * config.capacityKwh;
  const maxSocKwh = (config.maxSocPercent / 100) * config.capacityKwh;
  const usableRangeKwh = maxSocKwh - minSocKwh;

  const etaCharge = Math.sqrt(config.roundTripEfficiencyPercent / 100);
  const etaDischarge = Math.sqrt(config.roundTripEfficiencyPercent / 100);

  const maxChargeKwhPerInterval = config.maxChargePowerKw * INTERVAL_HOURS;
  const maxDischargeKwhPerInterval = config.maxDischargePowerKw * INTERVAL_HOURS;

  const N = SOC_GRID_STATES;
  const stepKwh = usableRangeKwh / N;

  const maxChargeSteps = Math.floor((maxChargeKwhPerInterval * etaCharge) / stepKwh);
  const maxDischargeSteps = Math.floor(maxDischargeKwhPerInterval / (etaDischarge * stepKwh));

  const netPv: number[] = new Array(T);
  const price: number[] = new Array(T);
  for (let t = 0; t < T; t += 1) {
    const scaledPv = (intervals[t]!.availablePvKwh ?? 0) * capacityFactor;
    const consumption = intervals[t]!.consumptionKwh ?? 0;
    netPv[t] = scaledPv - consumption;
    // A missing price makes that interval revenue-neutral for the
    // optimizer's decision-making (no incentive either way) - the
    // downstream, unchanged Revenue Engine has its own, separate handling
    // of a genuinely missing price when it computes the final totals.
    price[t] = priceByTime.get(intervals[t]!.intervalStart.getTime()) ?? 0;
  }

  const knownPrices = priceSeries.map((p) => p.price).filter((p): p is number => p !== null);
  const referencePrice = knownPrices.length > 0 ? knownPrices.reduce((sum, v) => sum + v, 0) / knownPrices.length : 0;

  let value = new Array<number>(N + 1);
  for (let j = 0; j <= N; j += 1) {
    const socKwh = minSocKwh + j * stepKwh;
    value[j] = (Math.max(0, socKwh - minSocKwh) * etaDischarge * referencePrice) / 1000;
  }

  const policy: Int32Array[] = new Array(T);

  for (let t = T - 1; t >= 0; t -= 1) {
    const nextValue = value;
    value = new Array<number>(N + 1);
    const policyRow = new Int32Array(N + 1);

    for (let j = 0; j <= N; j += 1) {
      const socKwh = minSocKwh + j * stepKwh;
      let best = -Infinity;
      let bestK = j;

      // Idle - no battery action this interval; export any surplus, import any deficit directly.
      {
        const gridExchange = netPv[t]!;
        const candidateValue = (price[t]! * gridExchange) / 1000 + nextValue[j]!;
        best = candidateValue;
        bestK = j;
      }

      // Charge - move to a higher grid level. `chargeKwh` is monotonically
      // increasing in k, so once it exceeds the available bound we can
      // stop scanning further k values.
      const chargeUpperK = Math.min(N, j + maxChargeSteps);
      for (let k = j + 1; k <= chargeUpperK; k += 1) {
        const targetSoc = minSocKwh + k * stepKwh;
        const chargeKwh = (targetSoc - socKwh) / etaCharge;
        if (!config.allowGridCharging && chargeKwh > Math.max(0, netPv[t]!) + 1e-9) {
          break;
        }

        const gridExchange = netPv[t]! - chargeKwh;
        const candidateValue = (price[t]! * gridExchange) / 1000 + nextValue[k]!;
        if (candidateValue > best) {
          best = candidateValue;
          bestK = k;
        }
      }

      // Discharge - move to a lower grid level. Never restricted to only
      // covering a local deficit; a pure price-arbitrage sale into a
      // surplus interval is always a legal action, per this engine's
      // objective (maximum financial return, not maximum self-consumption).
      const dischargeLowerK = Math.max(0, j - maxDischargeSteps);
      for (let k = j - 1; k >= dischargeLowerK; k -= 1) {
        const targetSoc = minSocKwh + k * stepKwh;
        const dischargeKwh = (socKwh - targetSoc) * etaDischarge;
        const gridExchange = netPv[t]! + dischargeKwh;
        const candidateValue = (price[t]! * gridExchange) / 1000 + nextValue[k]!;
        if (candidateValue > best) {
          best = candidateValue;
          bestK = k;
        }
      }

      value[j] = best;
      policyRow[j] = bestK;
    }

    policy[t] = policyRow;
  }

  const results: BatteryDispatchInterval[] = new Array(T);
  let currentIndex = 0;

  for (let t = 0; t < T; t += 1) {
    const socKwh = minSocKwh + currentIndex * stepKwh;
    const targetIndex = policy[t]![currentIndex]!;
    const targetSoc = minSocKwh + targetIndex * stepKwh;

    let chargeKwh = 0;
    let dischargeKwh = 0;
    if (targetIndex > currentIndex) {
      chargeKwh = (targetSoc - socKwh) / etaCharge;
    } else if (targetIndex < currentIndex) {
      dischargeKwh = (socKwh - targetSoc) * etaDischarge;
    }

    const gridExchange = netPv[t]! - chargeKwh + dischargeKwh;
    const exportedKwh = Math.max(0, gridExchange);
    const importedKwh = Math.max(0, -gridExchange);

    results[t] = {
      intervalStart: intervals[t]!.intervalStart,
      availablePvKwh: Math.round((intervals[t]!.availablePvKwh ?? 0) * capacityFactor * 100) / 100,
      consumptionKwh: Math.round((intervals[t]!.consumptionKwh ?? 0) * 100) / 100,
      chargeKwh: Math.round(chargeKwh * 100) / 100,
      dischargeKwh: Math.round(dischargeKwh * 100) / 100,
      exportedKwh: Math.round(exportedKwh * 100) / 100,
      importedKwh: Math.round(importedKwh * 100) / 100,
      socKwh: Math.round(targetSoc * 100) / 100,
    };

    currentIndex = targetIndex;
  }

  return results;
}
