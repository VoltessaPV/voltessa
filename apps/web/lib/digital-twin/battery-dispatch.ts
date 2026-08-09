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
 *   none of which apply here. Re-confirmed by the BESS optimization
 *   landscape research preceding the Zero-Export dispatch fix below - DP
 *   remains the correct architecture for V1's single-plant/single-battery
 *   scope; migrating to LP/MILP was explicitly evaluated and rejected.
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
 *   support one as an optional per-timestep percentage - a genuinely
 *   different thing from cycling degradation (see below), which the
 *   Battery Degradation Economics milestone now DOES model. The state
 *   equation above has an obvious slot for a standing-loss term if a later
 *   milestone needs it.
 * - No real-time/receding-horizon (MPC) execution loop, which is what
 *   OpenEMS's live Controllers actually run. This engine is offline/batch
 *   (Digital Twin replay) - Step 5's future Automation reuse is explicitly
 *   scoped as later work, not built here.
 *
 * Objective: `Σ [price_i × gridExchange_i / 1000 − degradationCostPerKwh ×
 * (charge_i + discharge_i)]` over the whole horizon, export positive,
 * import negative, using the same market price series both directions,
 * plus the terminal value below. The degradation term (Battery Degradation
 * Economics milestone) is an INTERNAL optimization cost only - it makes
 * economically marginal cycling unattractive to the search, but is never
 * folded into any reported revenue figure downstream (see
 * `BatteryConfig.degradationCostPerKwh`'s own doc comment and
 * `battery-engine-report.ts`'s separate `batteryWearCostEur`/
 * `optimizationValueEur` fields). Separately, this internal objective is
 * intentionally NOT the same number the (unchanged) Revenue Engine will
 * report afterward - that stays export-revenue-only by definition
 * (`computeExportRevenue`) - the benefit of avoided grid import shows up
 * instead in the Import/Consumption flows this engine also exposes, not
 * folded into "Revenue". See `BatteryDispatchInterval` below - every
 * physical energy flow is a first-class output field, deliberately, so
 * nothing about that decomposition is hidden or has to be guessed at by a
 * caller.
 *
 * Zero-Export dispatch fix - constrained-MDP architecture. This is a
 * single Bellman recursion for every native interval, normal or Zero
 * Export alike:
 *
 *   V_t(j) = max over feasible k of [ price_t · gridExchange_t(j,k) / 1000 ] + V_{t+1}(k)
 *
 * The only thing that changes between interval types is which `k` are
 * feasible from `j` - never a second objective, never a separate reward
 * term for curtailment. Two physics constraints narrow the feasible set,
 * applied uniformly regardless of what triggered them:
 *
 * - `allowGridCharging = false` removes any `k` whose charge would require
 *   grid import - `chargeCeilingK` below computes the resulting ceiling,
 *   and it is the SAME computation whether the cause is this config flag
 *   (any interval) or Zero Export's own PV-only mandatory absorption
 *   (Case 1) - both are "no grid import," just from different sources.
 * - Zero Export removes any `k` whose discharge would require export -
 *   `dischargeFloorK` below computes the resulting floor. Outside Zero
 *   Export this constraint doesn't exist - a pure price-arbitrage
 *   discharge into a surplus interval is always legal.
 *
 * `curtailedKwh` is never a decision - it is the deterministic residual of
 * the energy balance once `k` (hence `chargeKwh`) is fixed:
 * `availablePv = consumption + chargeKwh − dischargeKwh + gridExchange +
 * curtailedKwh`, with `gridExchange` pinned to 0 by the constraints above.
 * It carries no reward or penalty anywhere in the recursion - the model
 * that would need one (crediting/penalizing curtailed energy directly) was
 * considered and rejected: it either double-counts the same kWh's real,
 * later discharge reward, or - once corrected to not double-count -
 * reduces to nothing beyond what the ordinary price search already
 * computes from `V_{t+1}` on its own.
 *
 * Two Zero-Export cases result, both still governed by the same recursion
 * and the same feasible-set logic - not a second optimization phase:
 *
 * - CASE 1 (`!config.allowGridCharging`, or grid charging is allowed but
 *   price >= 0): the feasible charge ceiling is `chargeCeilingK` applied
 *   with the interval's own PV surplus as the affordability limit - PV is
 *   the only financing source. Before the Battery Degradation Economics
 *   milestone, landing at that ceiling was reached directly rather than
 *   searched for: every feasible `k` up to it shared the identical reward
 *   (0 - no grid exchange, since PV financing keeps gridExchange at exactly
 *   0) and `V_{t+1}` is non-decreasing in SOC, so the ceiling always weakly
 *   dominated every other feasible k. Once `degradationCostPerKwh > 0`,
 *   that dominance no longer holds automatically (more charge now always
 *   costs more wear, for only possibly-more future value), so every
 *   feasible k up to the ceiling is now genuinely searched -
 *   `zeroExportChargeReward` below, shared by both the backward induction
 *   and forward reconstruction passes. An optional extension beyond that
 *   ceiling is searched the same way (`allowGridCharging` grid-financed
 *   top-up, if a future price and the wear cost together still make it
 *   worthwhile).
 * - CASE 2 (`config.allowGridCharging && price < 0`): still an explicit
 *   business policy in the sense that PV is unconditionally curtailed and
 *   charging is unconditionally grid-financed instead (never a mix) -
 *   charging 1 kWh from the grid at a negative price earns revenue for the
 *   identical stored-energy benefit that charging the same kWh from PV
 *   would have earned for free, which is exactly the kind of decision this
 *   codebase requires to stay explainable rather than emergent (see
 *   `docs/VISION.md`'s "every automated action must be explainable").
 *   *How much* to charge under that policy is, like Case 1, now a genuine
 *   search once wear cost applies - a sufficiently small negative price no
 *   longer automatically justifies charging all the way to the power
 *   ceiling. This only applies when there is PV surplus to begin with; a
 *   plain deficit interval has no PV to override and goes through the
 *   ordinary feasible-set search below, unmodified.
 * - Outside those two cases (not Zero Export, or Zero Export with no
 *   surplus): the ordinary feasible-set search runs - `chargeCeilingK`
 *   applied only when `!allowGridCharging`, `dischargeFloorK` applied only
 *   when Zero Export is active (deficit-bounded, since discharging beyond
 *   the deficit would be a blocked export).
 *
 * `mandatoryChargeKwh` and `curtailedKwh` are first-class output fields
 * (see `BatteryDispatchInterval`) so a caller can distinguish "PV forced
 * into the battery by feasible-set dominance or the grid-priority policy"
 * from ordinary optimizer-chosen (`chargeKwh - mandatoryChargeKwh`)
 * charging, and from energy that was genuinely lost to curtailment.
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
  /**
   * Battery Degradation Economics milestone. EUR per kWh of charge+discharge
   * throughput - an INTERNAL optimization cost the DP subtracts from every
   * candidate's reward to make economically marginal cycling unattractive
   * (see computeDegradationCostPerKwh for the standard derivation). This is
   * never deducted from any reported market-revenue figure downstream
   * (battery-engine-report.ts keeps it as a separate `batteryWearCostEur`
   * field, subtracted only into a separate `optimizationValueEur`) - it
   * exists purely to shape the schedule the DP searches for. Pass 0 to
   * recover the exact prior (no-degradation) behavior.
   */
  degradationCostPerKwh: number;
};

/** Standard default battery-economics assumptions (LiFePO4 grid-scale BESS), used when a caller has no real vendor figures - see computeDegradationCostPerKwh. */
export const DEFAULT_BATTERY_CAPEX_EUR_PER_KWH = 200;
/** Rated cycle life, equivalent full cycles (EFC), for the same default assumption. */
export const DEFAULT_BATTERY_LIFETIME_EFC = 6000;

/**
 * Levelized battery-wear cost, EUR per kWh of charge+discharge throughput -
 * validated against an independent LP reference optimizer using this exact
 * formula (Battery Degradation Economics milestone).
 *
 * One equivalent full cycle (EFC) = one full charge PLUS one full discharge
 * of the usable (DoD-limited) range = `2 * usableCapacityKwh` kWh of
 * throughput - not `usableCapacityKwh` alone (a common off-by-a-factor-of-
 * two error this formula deliberately avoids). CAPEX is quoted per kWh of
 * NOMINAL capacity; since `usableCapacityKwh = nominalCapacityKwh *
 * dodFraction`, the nominal capacity cancels out of the ratio below - this
 * cost is therefore independent of battery size by construction and needs
 * no rescaling as capacity/duration changes:
 *
 *   costPerKwh = (capexPerKwh * capacityKwh) / (lifetimeEfc * 2 * dod * capacityKwh)
 *              = capexPerKwh / (2 * lifetimeEfc * dod)
 */
export function computeDegradationCostPerKwh(capexEurPerKwh: number, lifetimeEfc: number, dodPercent: number): number {
  const dod = dodPercent / 100;
  return capexEurPerKwh / (2 * lifetimeEfc * dod);
}

/**
 * Every physical energy flow for one native dispatch interval, all
 * mandatory - these become the inputs to battery throughput/cycle-counting/
 * degradation KPIs and automation diagnostics later, and the Digital Twin
 * UI visualizes `socKwh` directly alongside Grid Import/Export/Market
 * Price. Native resolution (see `runBatteryDispatch`'s own doc comment) -
 * no longer assumed 15-minute; a caller that needs a 15-minute settlement
 * view aggregates this output afterward (see `replay-engine.ts`), it is no
 * longer produced pre-aggregated by this function.
 */
export type BatteryDispatchInterval = {
  intervalStart: Date;
  availablePvKwh: number;
  consumptionKwh: number;
  /** Total charge this interval - mandatory (PV-absorption or grid-priority) plus any optional/optimizer-chosen portion. */
  chargeKwh: number;
  dischargeKwh: number;
  exportedKwh: number;
  importedKwh: number;
  /**
   * Zero-Export dispatch fix. The PV-financed portion of `chargeKwh` (as
   * opposed to any additional grid-financed portion, only possible when
   * `allowGridCharging` is true) during a Zero-Export surplus interval. 0
   * outside Zero Export. Prior to the Battery Degradation Economics
   * milestone this was also the "forced by dominance" portion - charging
   * further was always free, so the PV-affordability ceiling was reached
   * directly rather than searched for. That dominance no longer holds once
   * `degradationCostPerKwh > 0` (more charge now always costs more wear,
   * for only possibly-more future value), so this amount is now a genuine
   * optimizer decision like any other, not a forced minimum - the field name
   * is kept for continuity but no longer implies "mandatory."
   */
  mandatoryChargeKwh: number;
  /**
   * Reconstructed Available PV that was physically available this interval
   * but neither consumed locally, charged into the battery, nor exported -
   * a deterministic residual of the energy balance, never itself a chosen
   * or priced quantity. Two distinct, unrelated causes, both real: (1) Zero
   * Export dispatch fix - export was physically blocked and the battery was
   * already at its capacity/power limit; (2) Battery Degradation Economics
   * milestone's Case 3 economic curtailment - export was legal but would
   * have had negative market value (see `pvHandlingReward`), and curtailing
   * strictly dominates selling at a loss. Never both at once for the same
   * kWh (Case 1/2 and Case 3 are mutually exclusive per interval).
   */
  curtailedKwh: number;
  /** State of charge at the END of this interval. State, not an energy flow - never sum or average this across a coarser view; see this file's aggregation note. */
  socKwh: number;
};

/** Discretized SOC grid resolution - resolution scales with battery size automatically since the step is usableRangeKwh / this. */
const SOC_GRID_STATES = 200;
/** ENTSO-E's native day-ahead price resolution, independent of the dispatch interval's own (now native, sub-15-minute) cadence. */
const PRICE_BUCKET_MS = 15 * 60 * 1000;
/** Fallback interval duration when fewer than two intervals are supplied to derive spacing from - matches the native production cadence. */
const DEFAULT_INTERVAL_HOURS = 5 / 60;

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
  if (!(config.degradationCostPerKwh >= 0)) {
    throw new Error("Battery degradation cost per kWh must be non-negative");
  }
}

/**
 * Dynamic Programming, backward induction, over a discretized SOC grid.
 *
 * The action set at each step is "move from the current SOC grid level to
 * a reachable target grid level" (not "pick a continuous charge/discharge
 * amount and round the result") - every state the DP ever considers is
 * therefore exactly a grid point, by construction, so there is no rounding
 * drift accumulating over many timesteps, and the terminal handling below
 * stays numerically exact.
 *
 * Native resolution: the interval duration used for all power-limit math
 * (`maxChargeKwhPerInterval` etc.) is derived from `intervals[]`'s own
 * spacing (`intervals[1].intervalStart - intervals[0].intervalStart`)
 * rather than a hardcoded constant - this lets the same function correctly
 * dispatch a native 5-minute `AvailablePvInterval[]` timeline (the
 * production call path, see `replay-engine.ts`) and continue correctly
 * dispatching the 15-minute-spaced synthetic scenarios
 * `battery-optimality-check.ts` still uses, with no special-casing in
 * either caller. Market price data stays a fixed 15-minute ENTSO-E grid
 * regardless (`PRICE_BUCKET_MS`) - each interval resolves to the 15-minute
 * bucket it falls within.
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

  const intervalHours =
    T >= 2 ? (intervals[1]!.intervalStart.getTime() - intervals[0]!.intervalStart.getTime()) / 3_600_000 : DEFAULT_INTERVAL_HOURS;

  const maxChargeKwhPerInterval = config.maxChargePowerKw * intervalHours;
  const maxDischargeKwhPerInterval = config.maxDischargePowerKw * intervalHours;

  const N = SOC_GRID_STATES;
  const stepKwh = usableRangeKwh / N;

  const maxChargeSteps = Math.floor((maxChargeKwhPerInterval * etaCharge) / stepKwh);
  const maxDischargeSteps = Math.floor(maxDischargeKwhPerInterval / (etaDischarge * stepKwh));

  const availablePv: number[] = new Array(T);
  const consumptionAt: number[] = new Array(T);
  const netPv: number[] = new Array(T);
  const price: number[] = new Array(T);
  const isZeroExport: boolean[] = new Array(T);
  const useGridPriority: boolean[] = new Array(T);
  for (let t = 0; t < T; t += 1) {
    const scaledPv = (intervals[t]!.availablePvKwh ?? 0) * capacityFactor;
    const consumption = intervals[t]!.consumptionKwh ?? 0;
    availablePv[t] = scaledPv;
    consumptionAt[t] = consumption;
    netPv[t] = scaledPv - consumption;
    // A missing price makes that interval revenue-neutral for the
    // optimizer's decision-making (no incentive either way) - the
    // downstream, unchanged Revenue Engine has its own, separate handling
    // of a genuinely missing price when it computes the final totals.
    const priceBucket = Math.floor(intervals[t]!.intervalStart.getTime() / PRICE_BUCKET_MS) * PRICE_BUCKET_MS;
    price[t] = priceByTime.get(priceBucket) ?? 0;
    isZeroExport[t] = intervals[t]!.isZeroExport;
    // Explicit business policy (Case 2), not a search outcome - see module doc comment.
    useGridPriority[t] = config.allowGridCharging && price[t]! < 0;
  }

  const knownPrices = priceSeries.map((p) => p.price).filter((p): p is number => p !== null);
  const referencePrice = knownPrices.length > 0 ? knownPrices.reduce((sum, v) => sum + v, 0) / knownPrices.length : 0;

  /**
   * Largest grid index reachable from `j` by charging, given a fixed
   * affordability limit (the "no grid import" feasible-set constraint) and
   * a power/capacity ceiling `powerCapK`. The SAME bound, regardless of
   * why it's being asked for: Case 1's mandatory absorption calls this
   * with `affordableKwh = surplus` (PV is the only financing source
   * there); the ordinary free search calls it with `affordableKwh =
   * max(0, netPv[t])` whenever `!config.allowGridCharging` - both are "how
   * far can PV alone finance this," just triggered by different callers.
   */
  function chargeCeilingK(j: number, socKwh: number, powerCapK: number, affordableKwh: number): number {
    let upper = j;
    for (let k = j + 1; k <= powerCapK; k += 1) {
      const targetSoc = minSocKwh + k * stepKwh;
      const chargeKwh = (targetSoc - socKwh) / etaCharge;
      if (chargeKwh > affordableKwh + 1e-9) {
        break;
      }
      upper = k;
    }
    return upper;
  }

  /**
   * Smallest grid index reachable from `j` by discharging, given a fixed
   * cap on how much may be discharged (the "no export" feasible-set
   * constraint during a Zero-Export deficit interval - discharging beyond
   * the deficit itself would be a blocked export) and a power/capacity
   * floor `powerFloorK`. Outside Zero Export this constraint doesn't
   * exist, so callers there simply never invoke this.
   */
  function dischargeFloorK(j: number, socKwh: number, powerFloorK: number, maxDischargeableKwh: number): number {
    let lower = j;
    for (let k = j - 1; k >= powerFloorK; k -= 1) {
      const targetSoc = minSocKwh + k * stepKwh;
      const dischargeKwh = (socKwh - targetSoc) * etaDischarge;
      if (dischargeKwh > maxDischargeableKwh + 1e-9) {
        break;
      }
      lower = k;
    }
    return lower;
  }

  /**
   * Case 1 / Case 2 reward for charging to grid index `k` from state `j`
   * during a Zero-Export surplus interval - `k = j` (no charge) is always a
   * valid candidate (curtail everything). Prior to the Battery Degradation
   * Economics milestone, landing at the PV-affordability ceiling (Case 1)
   * or the full power ceiling (Case 2) always weakly dominated every lesser
   * k, because charging further was reward-neutral (gridExchange pinned at
   * 0 or the fixed Case-2 policy value regardless of how much of the
   * ceiling was used) and `V_{t+1}` is non-decreasing in SOC - so the
   * ceiling was reached directly, never searched for. Once
   * `degradationCostPerKwh > 0`, that dominance breaks: charging further
   * now has a real, increasing cost for only possibly-more future value, so
   * every reachable k up to the ceiling must be genuinely compared, exactly
   * like the ordinary Case 3 charge loop below. `curtailedKwh` (the energy-
   * balance residual for whatever isn't charged) still carries no reward or
   * penalty of its own - unchanged from the original design.
   */
  function zeroExportChargeReward(t: number, chargeKwh: number): number {
    const gridExchange = useGridPriority[t] ? -(consumptionAt[t]! + chargeKwh) : 0;
    return (price[t]! * gridExchange) / 1000 - config.degradationCostPerKwh * chargeKwh;
  }

  /**
   * Case 3 economic curtailment - completely independent of Zero Export's
   * own curtailment above (a physical export-blocked constraint, not an
   * economic choice - see the module doc comment). A positive raw grid
   * exchange (would-be export) competes here against curtailing that same
   * energy instead (always exactly 0 reward, 0 wear, no capacity/power
   * consumed) - `Math.max` genuinely decides between the two candidates
   * rather than a rule asserting which wins, so a price of exactly 0 is
   * correctly indifferent between them (both candidates evaluate to the
   * same reward) and any other price sign is handled by the same
   * comparison, not a special case. A negative raw exchange (import) is
   * never a curtailment candidate - it is a real physical deficit, not
   * surplus PV with nowhere useful to go.
   */
  function pvHandlingReward(t: number, rawGridExchange: number): number {
    if (rawGridExchange <= 0) {
      return (price[t]! * rawGridExchange) / 1000;
    }
    const exportReward = (price[t]! * rawGridExchange) / 1000;
    const curtailReward = 0;
    return Math.max(exportReward, curtailReward);
  }

  /** The energy-flow decomposition matching `pvHandlingReward`'s own decision - computed once, after a target SOC has been chosen, never re-decided independently. */
  function splitPvHandling(t: number, rawGridExchange: number): { exportedKwh: number; importedKwh: number; curtailedKwh: number } {
    if (rawGridExchange <= 0) {
      return { exportedKwh: 0, importedKwh: -rawGridExchange, curtailedKwh: 0 };
    }
    if (price[t]! * rawGridExchange < 0) {
      return { exportedKwh: 0, importedKwh: 0, curtailedKwh: rawGridExchange };
    }
    return { exportedKwh: rawGridExchange, importedKwh: 0, curtailedKwh: 0 };
  }

  /**
   * Continuous Forward Reconstruction. Backward induction (this loop) is
   * completely unchanged - same recursion, same objective, same grid,
   * still populates `policy[t][j]` for every grid state exactly as before
   * (diagnostics/regression/validation continue to read it; forward
   * reconstruction below no longer does). The one structural change: the
   * value table for every `t` is now retained (`valueByT`) instead of a
   * rolling two-buffer that discarded everything except the final array -
   * forward reconstruction runs as a separate, later pass (0 -> T-1, after
   * backward induction has finished T-1 -> 0), so it needs `V_{t+1}`
   * available for whichever `t` it's actually at, which the old rolling
   * buffer never kept. This is a memory-only change (`T x (N+1)` floats) -
   * the Bellman table itself is not being redefined, only preserved.
   */
  const valueByT: number[][] = new Array(T + 1);
  {
    const terminal = new Array<number>(N + 1);
    for (let j = 0; j <= N; j += 1) {
      const socKwh = minSocKwh + j * stepKwh;
      terminal[j] = (Math.max(0, socKwh - minSocKwh) * etaDischarge * referencePrice) / 1000;
    }
    valueByT[T] = terminal;
  }

  const policy: Int32Array[] = new Array(T);

  for (let t = T - 1; t >= 0; t -= 1) {
    const nextValue = valueByT[t + 1]!;
    const value = new Array<number>(N + 1);
    const policyRow = new Int32Array(N + 1);

    const surplusT = Math.max(0, netPv[t]!);

    for (let j = 0; j <= N; j += 1) {
      const socKwh = minSocKwh + j * stepKwh;
      const powerChargeCapK = Math.min(N, j + maxChargeSteps);
      const powerDischargeFloorK = Math.max(0, j - maxDischargeSteps);

      let best = -Infinity;
      let bestK = j;

      if (isZeroExport[t] && surplusT > 0) {
        // Case 1 / Case 2 - see zeroExportChargeReward's doc comment for why
        // this is now a genuine bounded search rather than a closed-form
        // jump to a dominant ceiling. k = j (no charge, everything
        // curtailed) is always included as the first candidate.
        const chargeCeiling = useGridPriority[t] ? powerChargeCapK : chargeCeilingK(j, socKwh, powerChargeCapK, surplusT);
        const chargeUpperK = config.allowGridCharging ? powerChargeCapK : chargeCeiling;

        best = zeroExportChargeReward(t, 0) + nextValue[j]!;
        bestK = j;

        for (let k = j + 1; k <= chargeUpperK; k += 1) {
          const targetSoc = minSocKwh + k * stepKwh;
          const chargeKwh = (targetSoc - socKwh) / etaCharge;
          const candidateValue = zeroExportChargeReward(t, chargeKwh) + nextValue[k]!;
          if (candidateValue > best) {
            best = candidateValue;
            bestK = k;
          }
        }
      } else {
        // The ordinary feasible-set search - identical recursion whether
        // this is a normal interval or a Zero-Export deficit interval.
        // Physics narrows the bounds, nothing else changes:
        //  - chargeCeilingK applied only when grid charging is disallowed
        //    (PV-affordability limit).
        //  - dischargeFloorK applied only during Zero Export (deficit
        //    limit - anything beyond it would be a blocked export).

        // Idle
        {
          const gridExchange = netPv[t]!;
          best = pvHandlingReward(t, gridExchange) + nextValue[j]!;
          bestK = j;
        }

        // Charge
        const chargeUpperK = config.allowGridCharging
          ? powerChargeCapK
          : chargeCeilingK(j, socKwh, powerChargeCapK, Math.max(0, netPv[t]!));
        for (let k = j + 1; k <= chargeUpperK; k += 1) {
          const targetSoc = minSocKwh + k * stepKwh;
          const chargeKwh = (targetSoc - socKwh) / etaCharge;
          const gridExchange = netPv[t]! - chargeKwh;
          const candidateValue = pvHandlingReward(t, gridExchange) - config.degradationCostPerKwh * chargeKwh + nextValue[k]!;
          if (candidateValue > best) {
            best = candidateValue;
            bestK = k;
          }
        }

        // Discharge
        const dischargeLowerK = isZeroExport[t]
          ? dischargeFloorK(j, socKwh, powerDischargeFloorK, Math.max(0, -netPv[t]!))
          : powerDischargeFloorK;
        for (let k = j - 1; k >= dischargeLowerK; k -= 1) {
          const targetSoc = minSocKwh + k * stepKwh;
          const dischargeKwh = (socKwh - targetSoc) * etaDischarge;
          const gridExchange = netPv[t]! + dischargeKwh;
          const candidateValue = pvHandlingReward(t, gridExchange) - config.degradationCostPerKwh * dischargeKwh + nextValue[k]!;
          if (candidateValue > best) {
            best = candidateValue;
            bestK = k;
          }
        }
      }

      value[j] = best;
      policyRow[j] = bestK;
    }

    valueByT[t] = value;
    policy[t] = policyRow;
  }

  /**
   * Continuous Forward Reconstruction (the actual replay). The Bellman grid
   * approximates the value function - it was never meant to define which
   * SOC values are physically reachable. So `policy[t][j]` (still populated
   * above, still available for diagnostics/regression/validation) is not
   * consulted here: the physical battery state is propagated as a genuine
   * continuous number, and every interval's decision is re-evaluated fresh
   * from that exact state, using the (unchanged, grid-discretized) value
   * tables only as an interpolated continuation-value oracle.
   */

  /** Linear interpolation of a discretized value array at a continuous SOC. Clamped at the grid ends - decisions never leave [minSocKwh, maxSocKwh] by construction, so this never actually extrapolates. */
  function interpolateValue(valueArray: number[], socKwh: number): number {
    const j = (socKwh - minSocKwh) / stepKwh;
    const jLo = Math.max(0, Math.min(N - 1, Math.floor(j)));
    const frac = Math.min(1, Math.max(0, j - jLo));
    return valueArray[jLo]! * (1 - frac) + valueArray[jLo + 1]! * frac;
  }

  /** Net grid exchange (export positive) of moving continuously from `fromSocKwh` to `toSocKwh` this interval - the same physical model as backward induction's own candidate evaluation, just unbound from the grid. */
  function gridExchangeFor(t: number, fromSocKwh: number, toSocKwh: number): number {
    if (toSocKwh > fromSocKwh + 1e-9) {
      const chargeKwh = (toSocKwh - fromSocKwh) / etaCharge;
      return netPv[t]! - chargeKwh;
    }
    if (toSocKwh < fromSocKwh - 1e-9) {
      const dischargeKwh = (fromSocKwh - toSocKwh) * etaDischarge;
      return netPv[t]! + dischargeKwh;
    }
    return netPv[t]!;
  }

  /**
   * g(x) = ImmediateReward(x) + InterpolatedFutureValue(x) - the single rule
   * every Case 3 candidate is evaluated by: the idle point, every reachable
   * grid breakpoint, and both feasibility boundaries alike. No candidate is
   * treated specially and there is no separate code path for any of them.
   * The wear-cost term uses the exact same `degradationCostPerKwh` constant
   * backward induction's Case 3 loops use, so both passes optimize the
   * identical objective.
   */
  function evaluateCandidate(t: number, fromSocKwh: number, nextValue: number[], targetSocKwh: number): number {
    const gridExchange = gridExchangeFor(t, fromSocKwh, targetSocKwh);
    const chargeKwh = targetSocKwh > fromSocKwh + 1e-9 ? (targetSocKwh - fromSocKwh) / etaCharge : 0;
    const dischargeKwh = targetSocKwh < fromSocKwh - 1e-9 ? (fromSocKwh - targetSocKwh) * etaDischarge : 0;
    const reward = pvHandlingReward(t, gridExchange) - config.degradationCostPerKwh * (chargeKwh + dischargeKwh);
    return reward + interpolateValue(nextValue, targetSocKwh);
  }

  /**
   * Continuous counterpart of the backward induction Case 1/2 search
   * (`zeroExportChargeReward`) - `fromSocKwh` itself (no charge, everything
   * curtailed) is always a valid candidate, exactly like `k = j` there.
   */
  function evaluateZeroExportCandidate(t: number, fromSocKwh: number, nextValue: number[], candidateSocKwh: number): number {
    const chargeKwh = candidateSocKwh > fromSocKwh + 1e-9 ? (candidateSocKwh - fromSocKwh) / etaCharge : 0;
    return zeroExportChargeReward(t, chargeKwh) + interpolateValue(nextValue, candidateSocKwh);
  }

  const results: BatteryDispatchInterval[] = new Array(T);
  let currentSocKwh = minSocKwh;

  for (let t = 0; t < T; t += 1) {
    const s = currentSocKwh;
    const nextValue = valueByT[t + 1]!;
    const surplusT = Math.max(0, netPv[t]!);

    let targetSoc: number;
    let mandatoryChargeKwh = 0;
    let curtailedKwh = 0;
    let gridExchange: number;

    if (isZeroExport[t] && surplusT > 0) {
      // Case 1 / Case 2 - genuine bounded search, continuous counterpart of
      // backward induction's own (see zeroExportChargeReward's doc comment
      // for why this is no longer a closed-form dominance jump).
      const pvAffordableCeilingSoc = Math.min(maxSocKwh, s + maxChargeKwhPerInterval * etaCharge, s + surplusT * etaCharge);
      const powerCapSoc = Math.min(maxSocKwh, s + maxChargeKwhPerInterval * etaCharge);
      const upperBoundSoc = useGridPriority[t] || config.allowGridCharging ? powerCapSoc : pvAffordableCeilingSoc;

      let bestSoc = s;
      let bestValue = evaluateZeroExportCandidate(t, s, nextValue, s);

      const kLo = Math.max(0, Math.ceil((s - minSocKwh) / stepKwh));
      const kHi = Math.min(N, Math.floor((upperBoundSoc - minSocKwh) / stepKwh));
      for (let k = kLo; k <= kHi; k += 1) {
        const candidateSoc = minSocKwh + k * stepKwh;
        if (candidateSoc <= s + 1e-9 || candidateSoc > upperBoundSoc + 1e-9) {
          continue;
        }
        const v = evaluateZeroExportCandidate(t, s, nextValue, candidateSoc);
        if (v > bestValue) {
          bestValue = v;
          bestSoc = candidateSoc;
        }
      }
      {
        const v = evaluateZeroExportCandidate(t, s, nextValue, upperBoundSoc);
        if (v > bestValue) {
          bestValue = v;
          bestSoc = upperBoundSoc;
        }
      }

      targetSoc = bestSoc;
      const chargeKwhFinal = targetSoc > s + 1e-9 ? (targetSoc - s) / etaCharge : 0;
      if (useGridPriority[t]) {
        mandatoryChargeKwh = 0; // fully grid-financed, see this field's updated doc comment
        curtailedKwh = availablePv[t]!;
        gridExchange = -(consumptionAt[t]! + chargeKwhFinal);
      } else {
        mandatoryChargeKwh = Math.min(chargeKwhFinal, surplusT); // PV-financed portion
        curtailedKwh = Math.max(0, surplusT - chargeKwhFinal);
        gridExchange = 0;
      }
    } else {
      // Case 3 - a single continuous optimization variable x = nextSocKwh,
      // no separate "charge decision" and "discharge decision". Candidates:
      // the idle point, every value-function breakpoint (grid point) inside
      // the feasible interval, and both feasible boundaries - all evaluated
      // by the exact same `evaluateCandidate` rule.
      const upperBoundSoc = config.allowGridCharging
        ? Math.min(maxSocKwh, s + maxChargeKwhPerInterval * etaCharge)
        : Math.min(maxSocKwh, s + maxChargeKwhPerInterval * etaCharge, s + surplusT * etaCharge);

      const lowerBoundSoc = isZeroExport[t]
        ? Math.max(minSocKwh, s - maxDischargeKwhPerInterval / etaDischarge, s - Math.max(0, -netPv[t]!) / etaDischarge)
        : Math.max(minSocKwh, s - maxDischargeKwhPerInterval / etaDischarge);

      let bestSoc = s;
      let bestValue = evaluateCandidate(t, s, nextValue, s);

      const kLo = Math.max(0, Math.ceil((lowerBoundSoc - minSocKwh) / stepKwh));
      const kHi = Math.min(N, Math.floor((upperBoundSoc - minSocKwh) / stepKwh));
      for (let k = kLo; k <= kHi; k += 1) {
        const candidateSoc = minSocKwh + k * stepKwh;
        if (candidateSoc < lowerBoundSoc - 1e-9 || candidateSoc > upperBoundSoc + 1e-9) {
          continue;
        }
        const v = evaluateCandidate(t, s, nextValue, candidateSoc);
        if (v > bestValue) {
          bestValue = v;
          bestSoc = candidateSoc;
        }
      }
      {
        const v = evaluateCandidate(t, s, nextValue, lowerBoundSoc);
        if (v > bestValue) {
          bestValue = v;
          bestSoc = lowerBoundSoc;
        }
      }
      {
        const v = evaluateCandidate(t, s, nextValue, upperBoundSoc);
        if (v > bestValue) {
          bestValue = v;
          bestSoc = upperBoundSoc;
        }
      }

      targetSoc = bestSoc;
      const rawGridExchange = gridExchangeFor(t, s, targetSoc);
      const split = splitPvHandling(t, rawGridExchange);
      gridExchange = rawGridExchange;
      curtailedKwh = split.curtailedKwh;
    }

    let chargeKwh = 0;
    let dischargeKwh = 0;
    if (targetSoc > s + 1e-9) {
      chargeKwh = (targetSoc - s) / etaCharge;
    } else if (targetSoc < s - 1e-9) {
      dischargeKwh = (s - targetSoc) * etaDischarge;
    }

    const exportedKwh = curtailedKwh > 0 ? 0 : Math.max(0, gridExchange);
    const importedKwh = Math.max(0, -gridExchange);

    results[t] = {
      intervalStart: intervals[t]!.intervalStart,
      availablePvKwh: Math.round(availablePv[t]! * 100) / 100,
      consumptionKwh: Math.round(consumptionAt[t]! * 100) / 100,
      chargeKwh: Math.round(chargeKwh * 100) / 100,
      dischargeKwh: Math.round(dischargeKwh * 100) / 100,
      exportedKwh: Math.round(exportedKwh * 100) / 100,
      importedKwh: Math.round(importedKwh * 100) / 100,
      mandatoryChargeKwh: Math.round(mandatoryChargeKwh * 100) / 100,
      curtailedKwh: Math.round(curtailedKwh * 100) / 100,
      socKwh: Math.round(targetSoc * 100) / 100,
    };

    currentSocKwh = targetSoc;
  }

  return results;
}
