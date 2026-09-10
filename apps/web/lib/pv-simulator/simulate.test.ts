import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deriveRates,
  pvScalingFactor,
  runSimulation,
  simulateInterval,
  SimulationValidationError,
  type SimulationInputInterval,
  type SimulationMode,
  type SimulationParams,
} from "./simulate";

const BASE = Date.UTC(2026, 4, 1, 6, 0, 0); // 2026-05-01T06:00:00Z == 09:00 Europe/Sofia
const STEP = 15 * 60 * 1000;

function interval(i: number, loadKwh: number | null, referencePvKwh: number | null): SimulationInputInterval {
  const start = new Date(BASE + i * STEP);
  return {
    intervalStartUtc: start,
    localLabel: labelFor(start),
    loadKwh,
    referencePvKwh,
    inputQuality: "ok",
  };
}

// Europe/Sofia is UTC+3 in May.
function labelFor(start: Date): string {
  const t = new Date(start.getTime() + 3 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

const params = (
  target: number,
  ref: number,
  mode: SimulationMode,
): SimulationParams => ({ targetCapacityKwp: target, referenceCapacityKwp: ref, mode });

test("scenario 1 — the exact specification example (export disabled)", () => {
  const r = simulateInterval(interval(0, 60, 13.63), params(500, 100, "self_consumption_only"));
  assert.equal(r.simulatedPvKwh, 68.15); // 13.63 × (500 / 100)
  assert.equal(r.pvUsedOnSiteKwh, 60);
  assert.equal(r.gridImportWithoutPvKwh, 60);
  assert.equal(r.gridImportWithPvKwh, 0);
  assert.equal(r.pvSurplusKwh, 8.15);
  assert.equal(r.gridExportKwh, 0);
  assert.equal(r.pvCurtailedKwh, 8.15);
  assert.equal(r.quality, "ok");
});

test("scenario 1 — the exact specification example (export enabled)", () => {
  const r = simulateInterval(interval(0, 60, 13.63), params(500, 100, "self_consumption_plus_export"));
  assert.equal(r.simulatedPvKwh, 68.15);
  assert.equal(r.pvUsedOnSiteKwh, 60);
  assert.equal(r.gridImportWithPvKwh, 0);
  assert.equal(r.gridExportKwh, 8.15);
  assert.equal(r.pvCurtailedKwh, 0);
});

test("scenario 2 — PV smaller than load: partial offset, no surplus", () => {
  const r = simulateInterval(interval(0, 100, 8), params(500, 100, "self_consumption_plus_export"));
  assert.equal(r.simulatedPvKwh, 40); // 8 × 5
  assert.equal(r.pvUsedOnSiteKwh, 40);
  assert.equal(r.gridImportWithPvKwh, 60);
  assert.equal(r.pvSurplusKwh, 0);
  assert.equal(r.gridExportKwh, 0);
  assert.equal(r.pvCurtailedKwh, 0);
});

test("scenario 3 — PV exactly equal to load", () => {
  const r = simulateInterval(interval(0, 50, 10), params(500, 100, "self_consumption_plus_export"));
  assert.equal(r.simulatedPvKwh, 50);
  assert.equal(r.pvUsedOnSiteKwh, 50);
  assert.equal(r.gridImportWithPvKwh, 0);
  assert.equal(r.pvSurplusKwh, 0);
  assert.equal(r.gridExportKwh, 0);
  assert.equal(r.pvCurtailedKwh, 0);
});

test("scenario 4 — PV greater than load: export vs curtailment by mode", () => {
  const exp = simulateInterval(interval(0, 20, 10), params(500, 100, "self_consumption_plus_export"));
  assert.equal(exp.simulatedPvKwh, 50);
  assert.equal(exp.pvUsedOnSiteKwh, 20);
  assert.equal(exp.gridImportWithPvKwh, 0);
  assert.equal(exp.pvSurplusKwh, 30);
  assert.equal(exp.gridExportKwh, 30);
  assert.equal(exp.pvCurtailedKwh, 0);

  const off = simulateInterval(interval(0, 20, 10), params(500, 100, "self_consumption_only"));
  assert.equal(off.gridExportKwh, 0);
  assert.equal(off.pvCurtailedKwh, 30);
});

test("scenario 5 — zero / negative PV capacity fails validation", () => {
  assert.throws(() => pvScalingFactor(0, 100), SimulationValidationError);
  assert.throws(() => pvScalingFactor(-10, 100), SimulationValidationError);
  assert.throws(() => pvScalingFactor(NaN, 100), SimulationValidationError);
  assert.throws(
    () => simulateInterval(interval(0, 60, 13.63), params(0, 100, "self_consumption_only")),
    SimulationValidationError,
  );
  assert.throws(
    () => runSimulation([interval(0, 60, 13.63)], params(0, 100, "self_consumption_only"), "Europe/Sofia"),
    SimulationValidationError,
  );
});

test("scenario 5b — a reference plant with no capacity fails validation", () => {
  assert.throws(() => pvScalingFactor(500, 0), SimulationValidationError);
});

test("scenario 6 — a missing load interval: every output null, contributes nothing", () => {
  const r = simulateInterval(interval(0, null, 13.63), params(500, 100, "self_consumption_only"));
  assert.equal(r.quality, "missing_load");
  assert.equal(r.loadKwh, null);
  assert.equal(r.gridImportWithoutPvKwh, null);
  assert.equal(r.simulatedPvKwh, null);
  assert.equal(r.gridExportKwh, null);

  const sim = runSimulation(
    [interval(0, 60, 10), interval(1, null, 10), interval(2, 40, 10)],
    params(500, 100, "self_consumption_plus_export"),
    "Europe/Sofia",
  );
  assert.equal(sim.quality.missingLoadIntervals, 1);
  assert.equal(sim.total.loadIntervals, 2);
  assert.equal(sim.total.consumptionKwh, 100); // 60 + 40, the null excluded
});

test("scenario 6b — a missing reference-PV interval: load kept, grid import unchanged, PV side excluded", () => {
  const r = simulateInterval(interval(0, 60, null), params(500, 100, "self_consumption_only"));
  assert.equal(r.quality, "no_reference_pv");
  assert.equal(r.loadKwh, 60);
  assert.equal(r.gridImportWithoutPvKwh, 60);
  assert.equal(r.gridImportWithPvKwh, 60); // no PV -> grid import unchanged
  assert.equal(r.simulatedPvKwh, null); // production is not invented
  assert.equal(r.pvUsedOnSiteKwh, null);

  const sim = runSimulation(
    [interval(0, 60, 10), interval(1, 40, null)],
    params(500, 100, "self_consumption_plus_export"),
    "Europe/Sofia",
  );
  assert.equal(sim.total.consumptionKwh, 100); // both intervals count for consumption
  assert.equal(sim.total.gridImportWithoutPvKwh, 100);
  // interval 0: load 60, simPv 50 -> import 10 ; interval 1: no PV -> import 40
  assert.equal(sim.total.gridImportWithPvKwh, 50);
  assert.equal(sim.total.pvIntervals, 1); // only the first has PV
  assert.equal(sim.total.coveredConsumptionKwh, 60); // covered-period denominator = interval 0 load only
  assert.equal(sim.total.pvUsedOnSiteKwh, 50);
  // whole-period reduction == total PV used on-site
  assert.equal(sim.totalRates.gridImportReductionKwh, 50);
  assert.equal(sim.quality.noReferencePvIntervals, 1);
});

test("scenario 7 — duplicate intervals: later value wins, both counted at the profile layer", () => {
  // `runSimulation` operates on already-de-duplicated intervals (see load-profile.test.ts
  // for the parse-time de-dup); here we assert it never double-counts a repeated instant.
  const a = interval(0, 60, 10);
  const sim = runSimulation([a, a], params(500, 100, "self_consumption_plus_export"), "Europe/Sofia");
  // Two identical rows -> two intervals in the output (ordering preserved), each simulated.
  assert.equal(sim.intervals.length, 2);
  assert.equal(sim.total.consumptionKwh, 120);
});

test("scenario 8 — a DST-flagged interval is still simulated and counted, but flagged", () => {
  const iv: SimulationInputInterval = { ...interval(0, 60, 10), inputQuality: "dst_ambiguous" };
  const r = simulateInterval(iv, params(500, 100, "self_consumption_plus_export"));
  assert.equal(r.quality, "dst_ambiguous");
  assert.equal(r.pvUsedOnSiteKwh, 50);
  const sim = runSimulation([iv], params(500, 100, "self_consumption_plus_export"), "Europe/Sofia");
  assert.equal(sim.quality.dstAmbiguousIntervals, 1);
  assert.equal(sim.total.consumptionKwh, 60);
});

test("scenario 9 — leap year: a Feb 29 interval simulates like any other", () => {
  const feb29 = new Date(Date.UTC(2028, 1, 29, 10, 0, 0));
  const iv: SimulationInputInterval = {
    intervalStartUtc: feb29,
    localLabel: "2028-02-29 13:00",
    loadKwh: 60,
    referencePvKwh: 13.63,
    inputQuality: "ok",
  };
  const r = simulateInterval(iv, params(500, 100, "self_consumption_only"));
  assert.equal(r.simulatedPvKwh, 68.15);
  const sim = runSimulation([iv], params(500, 100, "self_consumption_only"), "Europe/Sofia");
  assert.equal(sim.monthly[0]?.month, "2028-02");
});

test("scenario 10 — monthly aggregation sums interval quantities", () => {
  const may = [interval(0, 100, 10), interval(1, 80, 10), interval(2, 60, 10)];
  // Put one interval in June by jumping a month.
  const juneStart = new Date(Date.UTC(2026, 5, 1, 6, 0, 0));
  const june: SimulationInputInterval = {
    intervalStartUtc: juneStart,
    localLabel: labelFor(juneStart),
    loadKwh: 200,
    referencePvKwh: 10,
    inputQuality: "ok",
  };
  const sim = runSimulation([...may, june], params(500, 100, "self_consumption_plus_export"), "Europe/Sofia");
  const m0 = sim.monthly.find((m) => m.month === "2026-05");
  const m1 = sim.monthly.find((m) => m.month === "2026-06");
  assert.ok(m0 && m1);
  assert.equal(m0.totals.consumptionKwh, 240); // 100+80+60
  assert.equal(m1.totals.consumptionKwh, 200);
  assert.equal(sim.total.consumptionKwh, 440);
});

test("scenario 11 — the full-period TOTAL equals the sum of the monthly totals", () => {
  const intervals = Array.from({ length: 20 }, (_, i) => interval(i, 50 + i, 8));
  const sim = runSimulation(intervals, params(250, 100, "self_consumption_plus_export"), "Europe/Sofia");
  const sumOfMonths = sim.monthly.reduce((s, m) => s + m.totals.gridExportKwh, 0);
  assert.equal(Math.round(sumOfMonths * 1000) / 1000, sim.total.gridExportKwh);
  const sumCons = sim.monthly.reduce((s, m) => s + m.totals.consumptionKwh, 0);
  assert.equal(Math.round(sumCons * 1000) / 1000, sim.total.consumptionKwh);
});

test("scenario 12 — rates come from totals, not an average of per-interval or per-month rates", () => {
  // Interval A: load 100, simPv 20 -> self-cons rate 100%, coverage 20%
  // Interval B: load 10,  simPv 100 -> self-cons rate 10%,  coverage 100%
  const sim = runSimulation(
    [interval(0, 100, 4), interval(1, 10, 20)], // refCap 100, target 500 -> ×5 => simPv 20 and 100
    params(500, 100, "self_consumption_plus_export"),
    "Europe/Sofia",
  );
  // From totals: pvUsed = 20 + 10 = 30 ; pvGeneration = 20 + 100 = 120 ; consumption(PV intervals) = 110
  const rates = deriveRates(sim.total);
  const round4 = (v: number) => Math.round(v * 10000) / 10000;
  assert.equal(rates.selfConsumptionRate, round4(30 / 120)); // 0.25 — NOT the mean of (1.0, 0.1) = 0.55
  assert.equal(rates.solarCoverageRate, round4(30 / 110)); // 0.2727 — NOT the mean of (0.2, 1.0) = 0.6
  assert.equal(sim.totalRates.selfConsumptionRate, 0.25);
});

test("scenario 13 — export-disabled: export is always 0, surplus is curtailed", () => {
  const sim = runSimulation(
    [interval(0, 10, 20), interval(1, 5, 30)],
    params(500, 100, "self_consumption_only"),
    "Europe/Sofia",
  );
  assert.equal(sim.total.gridExportKwh, 0);
  assert.ok(sim.total.pvCurtailedKwh > 0);
  for (const iv of sim.intervals) assert.equal(iv.gridExportKwh, 0);
});

test("scenario 14 — export-enabled: surplus becomes export, curtailment is 0", () => {
  const sim = runSimulation(
    [interval(0, 10, 20), interval(1, 5, 30)],
    params(500, 100, "self_consumption_plus_export"),
    "Europe/Sofia",
  );
  assert.equal(sim.total.pvCurtailedKwh, 0);
  assert.ok(sim.total.gridExportKwh > 0);
  // Surplus == export in every interval.
  for (const iv of sim.intervals) assert.equal(iv.gridExportKwh, iv.pvSurplusKwh);
});

test("invariants — no negative import/export, pv_used never exceeds load", () => {
  const cases: Array<[number, number]> = [
    [0, 0], [100, 0], [0, 100], [50, 50], [60, 13.63], [1, 1000], [1000, 1],
  ];
  for (const [load, ref] of cases) {
    for (const mode of ["self_consumption_only", "self_consumption_plus_export"] as const) {
      const r = simulateInterval(interval(0, load, ref), params(500, 100, mode));
      assert.ok((r.gridImportWithPvKwh ?? 0) >= 0, `import >= 0 for ${load}/${ref}`);
      assert.ok((r.gridExportKwh ?? 0) >= 0, `export >= 0 for ${load}/${ref}`);
      assert.ok((r.pvUsedOnSiteKwh ?? 0) <= (r.loadKwh ?? 0) + 1e-9, `pv_used <= load for ${load}/${ref}`);
      if (mode === "self_consumption_only") assert.equal(r.gridExportKwh, 0);
    }
  }
});

test("interval ordering and count are preserved exactly", () => {
  const intervals = Array.from({ length: 50 }, (_, i) => interval(i, i % 7 === 0 ? null : 40 + i, 5));
  const sim = runSimulation(intervals, params(500, 100, "self_consumption_plus_export"), "Europe/Sofia");
  assert.equal(sim.intervals.length, 50);
  assert.deepEqual(
    sim.intervals.map((iv) => iv.intervalStartUtc.getTime()),
    intervals.map((iv) => iv.intervalStartUtc.getTime()),
  );
});
