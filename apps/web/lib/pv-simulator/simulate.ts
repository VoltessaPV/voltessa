/**
 * PV Self-Consumption / PV Impact Simulator — the pure physical-energy
 * core. No I/O. Given a customer 15-minute load profile and a matching
 * reference-plant production series, it answers "if this customer had a PV
 * installation of X kWp, how would their grid electricity change?".
 *
 * ## Units
 *
 * Every quantity here is **interval energy in kWh** for one 15-minute
 * interval. The load profile is provided as kWh/interval (see
 * `load-profile.ts`); the reference PV series is Voltessa's canonical
 * per-interval produced energy (`getPlantProductionEnergySeries`, kWh).
 * Like-for-like — no power/energy mixing inside this module.
 *
 * ## PV scaling
 *
 * `simulated_pv = reference_pv × (targetCapacityKwp / referenceCapacityKwp)`.
 * Never a hard-coded factor. `referenceCapacityKwp` is the reference
 * plant's canonical `Plant.capacityKw` (see `reference-plant.ts`).
 *
 * ## Per-interval calculation
 *
 *   pv_used_on_site       = min(load, simulated_pv)
 *   grid_import_without_pv = load
 *   grid_import_with_pv    = load − pv_used_on_site            (≥ 0)
 *   pv_surplus            = max(simulated_pv − load, 0)
 *   export allowed   → grid_export = pv_surplus ; pv_curtailed = 0
 *   export disabled  → grid_export = 0          ; pv_curtailed = pv_surplus
 *
 * Invariants (asserted by the tests): no negative import, no negative
 * export, pv_used ≤ load, no export when export is disabled.
 *
 * ## Missing data
 *
 * - `load = null`  → the interval is `missing_load`: every output is null,
 *   it contributes nothing to any total, and it is listed (blank) in the
 *   detail report. Never treated as 0.
 * - `referencePv = null` (the reference plant has no telemetry for that
 *   interval / day) → the interval is `no_reference_pv`: `simulated_pv`,
 *   `pv_used`, `pv_surplus`, `grid_export` and `pv_curtailed` are null and
 *   excluded from every PV total and from the covered-period rate
 *   denominators. `grid_import_without_pv` and `grid_import_with_pv` are
 *   both recorded as the load (no PV → no change), so the whole-period
 *   "grid import with PV" stays complete and directly comparable to "grid
 *   import without PV". `referencePv = 0` (a real reported zero, e.g.
 *   night) is NOT missing and simulates normally.
 */

export type SimulationMode = "self_consumption_only" | "self_consumption_plus_export";

export type IntervalDataQuality = "ok" | "missing_load" | "no_reference_pv" | "dst_ambiguous";

/** One interval fed to the simulator. `intervalStartUtc` is the real UTC instant of the interval's start. */
export type SimulationInputInterval = {
  intervalStartUtc: Date;
  /** Plant/reference timezone wall-clock label of the interval start, e.g. `2026-05-01 09:00`. */
  localLabel: string;
  /** kWh consumed in this 15-minute interval, or null if the source cell was blank. */
  loadKwh: number | null;
  /** Canonical reference-plant produced energy for this interval (kWh), or null if the reference plant has no data. */
  referencePvKwh: number | null;
  /** Pre-existing quality flag from profile parsing (e.g. a DST-ambiguous interval); `ok` otherwise. */
  inputQuality?: Exclude<IntervalDataQuality, "no_reference_pv">;
};

export type SimulationParams = {
  targetCapacityKwp: number;
  referenceCapacityKwp: number;
  mode: SimulationMode;
};

export type IntervalResult = {
  intervalStartUtc: Date;
  localLabel: string;
  quality: IntervalDataQuality;
  loadKwh: number | null;
  referencePvKwh: number | null;
  simulatedPvKwh: number | null;
  pvUsedOnSiteKwh: number | null;
  gridImportWithoutPvKwh: number | null;
  gridImportWithPvKwh: number | null;
  pvSurplusKwh: number | null;
  pvCurtailedKwh: number | null;
  gridExportKwh: number | null;
};

const KWH_DP = 4;
const round = (v: number, dp = KWH_DP): number => {
  const f = 10 ** dp;
  return Math.round((v + Number.EPSILON) * f) / f;
};

export class SimulationValidationError extends Error {}

/**
 * The scaling factor applied to the reference plant's production.
 * `referenceCapacityKwp` must be > 0; `targetCapacityKwp` must be > 0.
 */
export function pvScalingFactor(targetCapacityKwp: number, referenceCapacityKwp: number): number {
  if (!Number.isFinite(targetCapacityKwp) || targetCapacityKwp <= 0) {
    throw new SimulationValidationError("PV capacity must be greater than 0 kWp.");
  }
  if (!Number.isFinite(referenceCapacityKwp) || referenceCapacityKwp <= 0) {
    throw new SimulationValidationError(
      "The reference plant has no valid installed capacity (kWp) configured.",
    );
  }
  return targetCapacityKwp / referenceCapacityKwp;
}

/**
 * The core per-interval simulation. `load` and `referencePv` are kWh for
 * one 15-minute interval; a `null` in either is propagated per this
 * module's "Missing data" contract.
 */
export function simulateInterval(
  input: SimulationInputInterval,
  params: SimulationParams,
): IntervalResult {
  const factor = pvScalingFactor(params.targetCapacityKwp, params.referenceCapacityKwp);
  const { loadKwh, referencePvKwh } = input;

  const base: IntervalResult = {
    intervalStartUtc: input.intervalStartUtc,
    localLabel: input.localLabel,
    quality: input.inputQuality && input.inputQuality !== "ok" ? input.inputQuality : "ok",
    loadKwh: loadKwh === null ? null : round(loadKwh),
    referencePvKwh: referencePvKwh === null ? null : round(referencePvKwh),
    simulatedPvKwh: null,
    pvUsedOnSiteKwh: null,
    gridImportWithoutPvKwh: loadKwh === null ? null : round(loadKwh),
    gridImportWithPvKwh: null,
    pvSurplusKwh: null,
    pvCurtailedKwh: null,
    gridExportKwh: null,
  };

  if (loadKwh === null) {
    return { ...base, quality: "missing_load", gridImportWithoutPvKwh: null };
  }

  if (referencePvKwh === null) {
    // Load side is fully known; PV side cannot be simulated for this
    // interval. With no PV, grid import is unchanged (= load) — recorded so
    // whole-period "grid import with PV" stays complete and comparable —
    // while the PV-derived quantities stay null and are excluded from every
    // PV total and from the covered-period rate denominators.
    return { ...base, quality: "no_reference_pv", gridImportWithPvKwh: round(loadKwh) };
  }

  const load = Math.max(loadKwh, 0);
  const simulatedPv = Math.max(referencePvKwh * factor, 0);
  const pvUsed = Math.min(load, simulatedPv);
  const importWithPv = Math.max(load - pvUsed, 0);
  const surplus = Math.max(simulatedPv - load, 0);
  const exportKwh = params.mode === "self_consumption_plus_export" ? surplus : 0;
  const curtailed = params.mode === "self_consumption_plus_export" ? 0 : surplus;

  return {
    ...base,
    quality: base.quality === "dst_ambiguous" ? "dst_ambiguous" : "ok",
    simulatedPvKwh: round(simulatedPv),
    pvUsedOnSiteKwh: round(pvUsed),
    gridImportWithoutPvKwh: round(load),
    gridImportWithPvKwh: round(importWithPv),
    pvSurplusKwh: round(surplus),
    pvCurtailedKwh: round(curtailed),
    gridExportKwh: round(exportKwh),
  };
}

// --- Aggregation -----------------------------------------------------------

/**
 * Physical-energy totals over a set of interval results. Every field is a
 * SUM over intervals that have a value for it — never an average of
 * something that should be summed. Rates are computed from these totals
 * (see `deriveRates`), never by averaging per-interval or per-month rates.
 */
export type EnergyTotals = {
  /** Intervals counted for the load side (load not null). */
  loadIntervals: number;
  /** Intervals where PV was actually simulated (load AND reference PV both present). */
  pvIntervals: number;
  consumptionKwh: number;
  /** Grid import without PV, over every load interval (= consumption). */
  gridImportWithoutPvKwh: number;
  /**
   * Grid import with PV, over every load interval. Intervals with no
   * reference PV contribute their full load (no PV → no change), so this
   * stays whole-period and directly comparable to `gridImportWithoutPvKwh`.
   */
  gridImportWithPvKwh: number;
  /** Consumption over the `pvIntervals` subset only — the denominator for the covered-period rates. */
  coveredConsumptionKwh: number;
  /** Grid import with PV over the `pvIntervals` subset only. */
  coveredGridImportWithPvKwh: number;
  pvGenerationKwh: number;
  pvUsedOnSiteKwh: number;
  pvSurplusKwh: number;
  pvCurtailedKwh: number;
  gridExportKwh: number;
};

export function emptyTotals(): EnergyTotals {
  return {
    loadIntervals: 0,
    pvIntervals: 0,
    consumptionKwh: 0,
    gridImportWithoutPvKwh: 0,
    gridImportWithPvKwh: 0,
    coveredConsumptionKwh: 0,
    coveredGridImportWithPvKwh: 0,
    pvGenerationKwh: 0,
    pvUsedOnSiteKwh: 0,
    pvSurplusKwh: 0,
    pvCurtailedKwh: 0,
    gridExportKwh: 0,
  };
}

export function accumulate(totals: EnergyTotals, r: IntervalResult): void {
  if (r.loadKwh === null) return;
  totals.loadIntervals += 1;
  totals.consumptionKwh += r.loadKwh;
  totals.gridImportWithoutPvKwh += r.loadKwh;
  // Every load interval has a "with PV" grid import — for a no-reference-PV
  // interval it equals the load (no PV → unchanged).
  totals.gridImportWithPvKwh += r.gridImportWithPvKwh ?? r.loadKwh;

  if (r.simulatedPvKwh !== null) {
    totals.pvIntervals += 1;
    totals.coveredConsumptionKwh += r.loadKwh;
    totals.coveredGridImportWithPvKwh += r.gridImportWithPvKwh ?? 0;
    totals.pvGenerationKwh += r.simulatedPvKwh;
    totals.pvUsedOnSiteKwh += r.pvUsedOnSiteKwh ?? 0;
    totals.pvSurplusKwh += r.pvSurplusKwh ?? 0;
    totals.pvCurtailedKwh += r.pvCurtailedKwh ?? 0;
    totals.gridExportKwh += r.gridExportKwh ?? 0;
  }
}

export function finalizeTotals(totals: EnergyTotals, dp = 3): EnergyTotals {
  const f = 10 ** dp;
  const r = (v: number) => Math.round((v + Number.EPSILON) * f) / f;
  return {
    ...totals,
    consumptionKwh: r(totals.consumptionKwh),
    gridImportWithoutPvKwh: r(totals.gridImportWithoutPvKwh),
    gridImportWithPvKwh: r(totals.gridImportWithPvKwh),
    coveredConsumptionKwh: r(totals.coveredConsumptionKwh),
    coveredGridImportWithPvKwh: r(totals.coveredGridImportWithPvKwh),
    pvGenerationKwh: r(totals.pvGenerationKwh),
    pvUsedOnSiteKwh: r(totals.pvUsedOnSiteKwh),
    pvSurplusKwh: r(totals.pvSurplusKwh),
    pvCurtailedKwh: r(totals.pvCurtailedKwh),
    gridExportKwh: r(totals.gridExportKwh),
  };
}

export type DerivedRates = {
  /** PV used on-site ÷ PV generation (0..1). `null` if no PV generation. Unaffected by reference-PV coverage. */
  selfConsumptionRate: number | null;
  /** PV used on-site ÷ consumption, WHOLE period (0..1). `null` if no consumption. Diluted by any period with no reference PV. */
  solarCoverageRate: number | null;
  /** Grid-import reduction ÷ grid import without PV, WHOLE period (0..1). `null` if no import. */
  gridImportReductionRate: number | null;
  /** Grid import without PV − grid import with PV, WHOLE period (kWh). Equals total PV used on-site. */
  gridImportReductionKwh: number;
  /** PV used on-site ÷ consumption, over the reference-PV-covered intervals only (0..1). `null` if none. */
  coveredSolarCoverageRate: number | null;
  /** Grid-import reduction ÷ covered grid import without PV, over covered intervals only (0..1). */
  coveredGridImportReductionRate: number | null;
};

/** Rates from period totals — never an average of per-interval or per-month rates. */
export function deriveRates(totals: EnergyTotals, dp = 4): DerivedRates {
  const f = 10 ** dp;
  const r = (v: number) => Math.round((v + Number.EPSILON) * f) / f;
  const reduction = totals.gridImportWithoutPvKwh - totals.gridImportWithPvKwh;
  const coveredReduction = totals.coveredConsumptionKwh - totals.coveredGridImportWithPvKwh;
  return {
    selfConsumptionRate:
      totals.pvGenerationKwh > 0 ? r(totals.pvUsedOnSiteKwh / totals.pvGenerationKwh) : null,
    solarCoverageRate:
      totals.gridImportWithoutPvKwh > 0
        ? r(totals.pvUsedOnSiteKwh / totals.gridImportWithoutPvKwh)
        : null,
    gridImportReductionRate:
      totals.gridImportWithoutPvKwh > 0 ? r(reduction / totals.gridImportWithoutPvKwh) : null,
    gridImportReductionKwh: r(reduction),
    coveredSolarCoverageRate:
      totals.coveredConsumptionKwh > 0
        ? r(totals.pvUsedOnSiteKwh / totals.coveredConsumptionKwh)
        : null,
    coveredGridImportReductionRate:
      totals.coveredConsumptionKwh > 0 ? r(coveredReduction / totals.coveredConsumptionKwh) : null,
  };
}

export type MonthlyBucket = {
  /** `YYYY-MM` in the reference timezone. */
  month: string;
  totals: EnergyTotals;
  rates: DerivedRates;
};

export type HourlyBucket = {
  /** `YYYY-MM-DD HH` in the reference timezone. */
  hour: string;
  consumptionKwh: number;
  pvGenerationKwh: number;
  pvUsedOnSiteKwh: number;
  gridImportWithoutPvKwh: number;
  gridImportWithPvKwh: number;
  gridExportKwh: number;
  pvCurtailedKwh: number;
};

export type SimulationResult = {
  params: SimulationParams;
  mode: SimulationMode;
  timeZone: string;
  intervalMinutes: 15;
  /** Every interval, in input order — the source of truth. */
  intervals: IntervalResult[];
  monthly: MonthlyBucket[];
  hourly: HourlyBucket[];
  total: EnergyTotals;
  totalRates: DerivedRates;
  /** Interval-count breakdown for the data-quality summary. */
  quality: {
    totalIntervals: number;
    okIntervals: number;
    missingLoadIntervals: number;
    noReferencePvIntervals: number;
    dstAmbiguousIntervals: number;
    /** Distinct reference-timezone days that had at least one interval with no reference PV data. */
    daysWithoutAnyReferencePv: number;
    referencePvCoverageRate: number | null;
  };
};

function monthKey(localLabel: string): string {
  return localLabel.slice(0, 7); // "YYYY-MM"
}
function hourKey(localLabel: string): string {
  return localLabel.slice(0, 13); // "YYYY-MM-DD HH"
}
function dayKey(localLabel: string): string {
  return localLabel.slice(0, 10); // "YYYY-MM-DD"
}

/**
 * Runs the simulation over an ordered list of input intervals. Interval
 * ordering and count are preserved exactly — nothing is dropped.
 */
export function runSimulation(
  inputs: SimulationInputInterval[],
  params: SimulationParams,
  timeZone: string,
): SimulationResult {
  // Validate capacity once, up front, with a clear message.
  pvScalingFactor(params.targetCapacityKwp, params.referenceCapacityKwp);

  const intervals = inputs.map((input) => simulateInterval(input, params));

  const total = emptyTotals();
  const monthlyMap = new Map<string, EnergyTotals>();
  const hourlyMap = new Map<
    string,
    { c: number; g: number; u: number; iw: number; iwp: number; e: number; cu: number }
  >();
  const daysAll = new Set<string>();
  const daysWithPv = new Set<string>();

  let ok = 0;
  let missingLoad = 0;
  let noRefPv = 0;
  let dstAmbiguous = 0;

  for (const r of intervals) {
    daysAll.add(dayKey(r.localLabel));
    if (r.quality === "missing_load") missingLoad += 1;
    else if (r.quality === "no_reference_pv") {
      noRefPv += 1;
    } else if (r.quality === "dst_ambiguous") dstAmbiguous += 1;
    else ok += 1;

    if (r.simulatedPvKwh !== null) daysWithPv.add(dayKey(r.localLabel));

    accumulate(total, r);

    const mk = monthKey(r.localLabel);
    let mt = monthlyMap.get(mk);
    if (!mt) {
      mt = emptyTotals();
      monthlyMap.set(mk, mt);
    }
    accumulate(mt, r);

    if (r.loadKwh !== null) {
      const hk = hourKey(r.localLabel);
      let h = hourlyMap.get(hk);
      if (!h) {
        h = { c: 0, g: 0, u: 0, iw: 0, iwp: 0, e: 0, cu: 0 };
        hourlyMap.set(hk, h);
      }
      h.c += r.loadKwh;
      h.iw += r.loadKwh;
      // Every load interval has a "with PV" grid import (= load when no PV was simulated).
      h.iwp += r.gridImportWithPvKwh ?? r.loadKwh;
      if (r.simulatedPvKwh !== null) {
        h.g += r.simulatedPvKwh;
        h.u += r.pvUsedOnSiteKwh ?? 0;
        h.e += r.gridExportKwh ?? 0;
        h.cu += r.pvCurtailedKwh ?? 0;
      }
    }
  }

  const finalizedTotal = finalizeTotals(total);
  const monthly: MonthlyBucket[] = [...monthlyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, t]) => {
      const ft = finalizeTotals(t);
      return { month, totals: ft, rates: deriveRates(ft) };
    });

  const round3 = (v: number) => Math.round((v + Number.EPSILON) * 1000) / 1000;
  const hourly: HourlyBucket[] = [...hourlyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([hour, h]) => ({
      hour,
      consumptionKwh: round3(h.c),
      pvGenerationKwh: round3(h.g),
      pvUsedOnSiteKwh: round3(h.u),
      gridImportWithoutPvKwh: round3(h.iw),
      gridImportWithPvKwh: round3(h.iwp),
      gridExportKwh: round3(h.e),
      pvCurtailedKwh: round3(h.cu),
    }));

  const coverageDenominator = daysAll.size;
  return {
    params,
    mode: params.mode,
    timeZone,
    intervalMinutes: 15,
    intervals,
    monthly,
    hourly,
    total: finalizedTotal,
    totalRates: deriveRates(finalizedTotal),
    quality: {
      totalIntervals: intervals.length,
      okIntervals: ok,
      missingLoadIntervals: missingLoad,
      noReferencePvIntervals: noRefPv,
      dstAmbiguousIntervals: dstAmbiguous,
      daysWithoutAnyReferencePv: [...daysAll].filter((d) => !daysWithPv.has(d)).length,
      referencePvCoverageRate:
        coverageDenominator > 0
          ? Math.round((daysWithPv.size / coverageDenominator) * 10000) / 10000
          : null,
    },
  };
}
