import type { MarketPricePoint } from "@/app/[locale]/(platform)/market/market-data";
import type { AvailablePvInterval } from "@/lib/digital-twin/available-pv-reconstruction";
import { type BatteryConfig, runBatteryDispatch } from "@/lib/digital-twin/battery-dispatch";

/**
 * Battery Engine Diagnostics milestone - optimality validation.
 *
 * The milestone explicitly rules out "Revenue >= no-battery baseline" as a
 * correctness criterion (the optimizer is allowed to decide the best
 * action is to do nothing). What actually needs proving is that
 * `runBatteryDispatch` correctly IMPLEMENTS the algorithm it was designed
 * to (backward-induction DP is provably globally optimal by construction
 * when correctly implemented - that property doesn't need re-proving here,
 * only the CODE does).
 *
 * `bruteForceOptimalRevenue` below is a second, genuinely independent
 * implementation of the exact same problem - written from scratch as plain
 * recursive memoized search rather than the production engine's iterative
 * backward-induction style, sharing no code with `battery-dispatch.ts` -
 * using the identical physical model (same SOC transition equation, same
 * terminal-value convention, same grid-charging rule) so a match proves
 * the production code is a correct implementation of the designed
 * algorithm, not just internally self-consistent. Deliberately NOT a
 * general-purpose solver: the exhaustive recursion is only tractable for a
 * short horizon and a modest SOC grid, so it must only ever be run against
 * the small, hand-crafted scenarios below - never real multi-day data.
 */

export type OptimalityTestCase = {
  name: string;
  /** kWh per 15-minute interval, already capacity-scaled - `runBatteryDispatch` is called with capacityFactor = 1 for these. */
  availablePvKwh: number[];
  consumptionKwh: number[];
  priceEurPerMwh: number[];
  battery: BatteryConfig;
  /** Per-interval Zero-Export flag - defaults to all-false (no existing case needed it before the Battery Degradation Economics milestone's Case 1/2 rewrite). */
  isZeroExport?: boolean[];
};

const INTERVAL_HOURS = 15 / 60;
/** Deliberately small - keeps the exhaustive brute-force search fast and exact. */
const REFERENCE_SOC_STATES = 200;

/**
 * Exhaustively (with memoization) finds the true maximum total value
 * achievable over the whole horizon, given the exact same rules
 * `battery-dispatch.ts` is specified to follow: SOC transition
 * `soc += charge x etaCharge - discharge / etaDischarge`, PV-surplus-only
 * charging unless `allowGridCharging`, and a terminal value pricing
 * leftover SOC at the horizon's mean known price.
 */
export function bruteForceOptimalRevenue(testCase: OptimalityTestCase): number {
  const { availablePvKwh, consumptionKwh, priceEurPerMwh, battery } = testCase;
  const isZeroExport = testCase.isZeroExport ?? availablePvKwh.map(() => false);
  const T = availablePvKwh.length;

  const minSocKwh = (battery.minSocPercent / 100) * battery.capacityKwh;
  const maxSocKwh = (battery.maxSocPercent / 100) * battery.capacityKwh;
  const N = REFERENCE_SOC_STATES;
  const stepKwh = (maxSocKwh - minSocKwh) / N;

  const etaCharge = Math.sqrt(battery.roundTripEfficiencyPercent / 100);
  const etaDischarge = etaCharge;
  const maxChargeKwh = battery.maxChargePowerKw * INTERVAL_HOURS;
  const maxDischargeKwh = battery.maxDischargePowerKw * INTERVAL_HOURS;
  /** Physical AC export ceiling fix - independent re-derivation of `battery-dispatch.ts`'s `maxExportKwhPerInterval`, so this reference solver keeps validating the identical physical model. */
  const maxExportKwh = battery.exportPowerLimitKw * INTERVAL_HOURS;
  const referencePrice = priceEurPerMwh.reduce((sum, v) => sum + v, 0) / priceEurPerMwh.length;

  const memo = new Map<string, number>();

  function solve(t: number, socIndex: number): number {
    if (t === T) {
      const socKwh = minSocKwh + socIndex * stepKwh;
      return (Math.max(0, socKwh - minSocKwh) * etaDischarge * referencePrice) / 1000;
    }

    const key = `${t}:${socIndex}`;
    const cached = memo.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const socKwh = minSocKwh + socIndex * stepKwh;
    const netPv = availablePvKwh[t]! - consumptionKwh[t]!;
    const price = priceEurPerMwh[t]!;

    let best = -Infinity;

    for (let k = 0; k <= N; k += 1) {
      let chargeKwh = 0;
      let dischargeKwh = 0;

      if (k > socIndex) {
        const targetSoc = minSocKwh + k * stepKwh;
        chargeKwh = (targetSoc - socKwh) / etaCharge;
        if (chargeKwh > maxChargeKwh + 1e-9) {
          continue;
        }
        if (!battery.allowGridCharging && chargeKwh > Math.max(0, netPv) + 1e-9) {
          continue;
        }
      } else if (k < socIndex) {
        const targetSoc = minSocKwh + k * stepKwh;
        dischargeKwh = (socKwh - targetSoc) * etaDischarge;
        if (dischargeKwh > maxDischargeKwh + 1e-9) {
          continue;
        }
      }

      let gridExchange = netPv - chargeKwh + dischargeKwh;
      // Zero Export: no export allowed - any residual that would have been
      // exported is curtailed instead (zero reward, zero cost), never sold.
      // A candidate that discharges further than physically sensible under
      // this constraint is never actually chosen: it wastes stored energy
      // (and now wear cost) for the same zero reward idling would give, so
      // it's always weakly dominated - safe to allow in the search space
      // without a separate feasibility cutoff.
      if (isZeroExport[t] && gridExchange > 0) {
        gridExchange = 0;
      }
      // Physical AC export ceiling fix - a positive residual beyond the
      // plant's own installed/inverter AC capacity is physically
      // impossible to export, regardless of price; capped first, then the
      // pre-existing economic-curtailment check (below) runs over the
      // already-capped amount, exactly mirroring `pvHandlingReward`'s order.
      if (gridExchange > 0) {
        gridExchange = Math.min(gridExchange, maxExportKwh);
      }
      // Battery Degradation Economics milestone - Case 3 economic
      // curtailment, independent of Zero Export above: even when export is
      // physically legal, selling a positive residual at a negative price
      // is strictly worse than curtailing it (0 reward beats a negative
      // one) - an independent re-derivation of the same fact
      // battery-dispatch.ts's `pvHandlingReward` computes, not a shared
      // implementation.
      if (gridExchange > 0 && price < 0) {
        gridExchange = 0;
      }
      const revenue = (price * gridExchange) / 1000 - battery.degradationCostPerKwh * (chargeKwh + dischargeKwh);
      const total = revenue + solve(t + 1, k);
      if (total > best) {
        best = total;
      }
    }

    memo.set(key, best);
    return best;
  }

  // Battery starts at minSoc (index 0) - the same documented V1 assumption `runBatteryDispatch` makes.
  return Math.round(solve(0, 0) * 100) / 100;
}

function toEngineInputs(testCase: OptimalityTestCase): { intervals: AvailablePvInterval[]; priceSeries: MarketPricePoint[] } {
  const baseTimeMs = Date.UTC(2026, 0, 1, 0, 0, 0);
  const bucketMs = 15 * 60 * 1000;

  const intervals: AvailablePvInterval[] = testCase.availablePvKwh.map((pv, i) => ({
    intervalStart: new Date(baseTimeMs + i * bucketMs),
    availablePvKwh: pv,
    consumptionKwh: testCase.consumptionKwh[i]!,
    isZeroExport: testCase.isZeroExport?.[i] ?? false,
  }));

  const priceSeries: MarketPricePoint[] = testCase.priceEurPerMwh.map((price, i) => ({
    timestamp: new Date(baseTimeMs + i * bucketMs),
    price,
    exportEnabled: false,
  }));

  return { intervals, priceSeries };
}

export type OptimalityCheckResult = {
  name: string;
  engineTotalValueEur: number;
  referenceOptimalValueEur: number;
  discrepancyEur: number;
  matches: boolean;
};

/**
 * Runs the real `runBatteryDispatch` and the independent brute-force
 * reference on the same small scenario and compares their total value.
 * `runBatteryDispatch`'s own optimization objective includes a terminal
 * value for leftover SOC (see that module's doc comment - it's what stops
 * the optimizer artificially draining the battery just because the
 * horizon ends), so this must credit the engine's own final SOC the exact
 * same way, or two trajectories of genuinely EQUAL true value (a real tie
 * - e.g. two equal-priced intervals whose discharge order doesn't matter)
 * would incorrectly look like a discrepancy.
 */
export function runOptimalityCheck(testCase: OptimalityTestCase): OptimalityCheckResult {
  const { intervals, priceSeries } = toEngineInputs(testCase);
  const dispatch = runBatteryDispatch(intervals, 1, priceSeries, testCase.battery);

  const priceByTime = new Map(priceSeries.map((p) => [p.timestamp.getTime(), p.price]));
  // Battery Degradation Economics milestone. Must include the same
  // wear-cost term the engine's own search actually optimizes (see
  // battery-dispatch.ts's module doc comment for the objective) - otherwise
  // this comparison silently checks a different quantity than what the
  // engine was asked to maximize, and a schedule that's genuinely optimal
  // net of wear would incorrectly look like it "beats" the reference.
  const realizedValueEur = dispatch.reduce((sum, interval) => {
    const price = priceByTime.get(interval.intervalStart.getTime()) ?? 0;
    const revenue = (price * (interval.exportedKwh - interval.importedKwh)) / 1000;
    const wearCost = testCase.battery.degradationCostPerKwh * (interval.chargeKwh + interval.dischargeKwh);
    return sum + revenue - wearCost;
  }, 0);

  const minSocKwh = (testCase.battery.minSocPercent / 100) * testCase.battery.capacityKwh;
  const etaDischarge = Math.sqrt(testCase.battery.roundTripEfficiencyPercent / 100);
  const referencePrice = testCase.priceEurPerMwh.reduce((sum, v) => sum + v, 0) / testCase.priceEurPerMwh.length;
  const finalSocKwh = dispatch[dispatch.length - 1]?.socKwh ?? minSocKwh;
  const terminalValueEur = (Math.max(0, finalSocKwh - minSocKwh) * etaDischarge * referencePrice) / 1000;

  const engineTotalValueEur = Math.round((realizedValueEur + terminalValueEur) * 100) / 100;

  const referenceOptimalValueEur = bruteForceOptimalRevenue(testCase);
  const discrepancyEur = Math.round((engineTotalValueEur - referenceOptimalValueEur) * 100) / 100;

  return {
    name: testCase.name,
    engineTotalValueEur,
    referenceOptimalValueEur,
    discrepancyEur,
    matches: Math.abs(discrepancyEur) < 0.05,
  };
}

const BASE_BATTERY: BatteryConfig = {
  capacityKwh: 20,
  roundTripEfficiencyPercent: 95.4,
  minSocPercent: 10,
  maxSocPercent: 100,
  maxChargePowerKw: 20,
  maxDischargePowerKw: 20,
  allowGridCharging: false,
  // Nonzero (standard EUR200/kWh, 6000 EFC, 90% DoD assumption) so every
  // case below also validates the Battery Degradation Economics
  // milestone's wear-cost terms, not just the pre-existing physics.
  degradationCostPerKwh: 200 / (2 * 6000 * 0.9),
  // Physical AC export ceiling fix - these synthetic scenarios validate
  // battery dispatch logic, not any specific plant's inverter/interconnect
  // size, so this is set intentionally high (never binds for any of the
  // cases below) to keep this pre-existing suite's behavior unchanged. The
  // ceiling itself is validated separately, directly against real Atlanta
  // production data.
  exportPowerLimitKw: 1000,
};

/**
 * Small, hand-crafted scenarios, each designed to stress a specific
 * dispatch behavior. Kept intentionally short (8-12 intervals = 2-3 hours)
 * so `bruteForceOptimalRevenue`'s exhaustive search stays fast and exact.
 */
export const SYNTHETIC_OPTIMALITY_TEST_CASES: OptimalityTestCase[] = [
  {
    name: "Flat price - no incentive to cycle the battery",
    availablePvKwh: [5, 5, 5, 5, 0, 0, 0, 0],
    consumptionKwh: [1, 1, 1, 1, 1, 1, 1, 1],
    priceEurPerMwh: [80, 80, 80, 80, 80, 80, 80, 80],
    battery: BASE_BATTERY,
  },
  {
    name: "Rising price - charge early (cheap), discharge late (expensive)",
    availablePvKwh: [5, 5, 5, 5, 0, 0, 0, 0],
    consumptionKwh: [1, 1, 1, 1, 1, 1, 1, 1],
    priceEurPerMwh: [20, 25, 30, 35, 100, 120, 140, 160],
    battery: BASE_BATTERY,
  },
  {
    name: "Price spike mid-window, PV before and after",
    availablePvKwh: [4, 4, 4, 0, 0, 0, 4, 4],
    consumptionKwh: [1, 1, 1, 1, 1, 1, 1, 1],
    priceEurPerMwh: [40, 40, 40, 300, 300, 40, 40, 40],
    battery: BASE_BATTERY,
  },
  {
    name: "Negative price with PV surplus - avoid exporting into a negative price",
    availablePvKwh: [6, 6, 6, 6, 0, 0, 0, 0],
    consumptionKwh: [1, 1, 1, 1, 1, 1, 1, 1],
    priceEurPerMwh: [-20, -10, 5, 10, 120, 130, 90, 60],
    battery: BASE_BATTERY,
  },
  {
    name: "Grid charging enabled - cheap-then-expensive pure arbitrage",
    availablePvKwh: [0, 0, 0, 0, 0, 0, 0, 0],
    consumptionKwh: [0, 0, 0, 0, 0, 0, 0, 0],
    priceEurPerMwh: [10, 10, 10, 10, 150, 150, 150, 150],
    battery: { ...BASE_BATTERY, allowGridCharging: true },
  },
  {
    name: "Tiny battery under a large price swing - power/capacity limits must bind",
    availablePvKwh: [3, 3, 0, 0, 0, 0, 0, 0],
    consumptionKwh: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    priceEurPerMwh: [20, 20, 200, 200, 200, 40, 40, 40],
    battery: { ...BASE_BATTERY, capacityKwh: 1, maxChargePowerKw: 2, maxDischargePowerKw: 2 },
  },
  {
    // Battery Degradation Economics milestone (Case 3 economic
    // curtailment). NOT Zero Export - a tiny battery (capacity=1kWh,
    // power=2kW => 0.5kWh/interval max) facing a huge PV surplus (10kWh) at
    // a strongly negative price: the battery can absorb only a small
    // fraction, and the remainder has nowhere economically useful to go.
    // The optimizer must curtail the residual rather than being forced to
    // sell it at a loss - the exact structural gap identified during
    // validation (Chomakovtsi 2026-07-25).
    name: "Large PV surplus at negative price exceeds battery capacity, no Zero Export - must curtail rather than sell at a loss",
    availablePvKwh: [10, 10, 0, 0, 0, 0, 0, 0],
    consumptionKwh: [0, 0, 0, 0, 0, 0, 0, 0],
    priceEurPerMwh: [-50, -50, 50, 50, 50, 40, 40, 40],
    battery: { ...BASE_BATTERY, capacityKwh: 1, maxChargePowerKw: 2, maxDischargePowerKw: 2 },
  },
  {
    // Battery Degradation Economics milestone. Zero Export + PV surplus,
    // but a flat, very low price all horizon (referencePrice = 5) - the
    // terminal value of stored energy (~0.0049 EUR/kWh) is BELOW
    // degradationCostPerKwh (~0.0185 EUR/kWh). Before this milestone's
    // Case 1 rewrite, the "mandatory absorption" dominance argument would
    // have forced full-ceiling charging regardless of value; the correct
    // answer, and what the search must now find, is NOT to charge at all -
    // curtailing beats storing energy that's worth less than its own wear.
    name: "Zero Export with PV surplus, but wear cost exceeds any storage value - should NOT charge",
    availablePvKwh: [10, 10, 10, 10, 0, 0, 0, 0],
    consumptionKwh: [1, 1, 1, 1, 1, 1, 1, 1],
    priceEurPerMwh: [5, 5, 5, 5, 5, 5, 5, 5],
    isZeroExport: [true, true, true, true, false, false, false, false],
    battery: BASE_BATTERY,
  },
];
