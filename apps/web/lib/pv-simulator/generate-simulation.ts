/**
 * PV Simulator — orchestration. The only file in the feature that performs
 * I/O, and only through existing canonical entry points:
 *
 * - `getPlantProductionEnergySeries` (`lib/telemetry/energy-metrics.ts`) —
 *   the canonical Energy Engine, per-15-minute produced energy (kWh) from
 *   inverter power integration. This is the same function the admin
 *   Reporting feature uses for "PV Production" and the Market page uses for
 *   a meterless (Producer) plant's revenue. Chomakovtsi has no meter, so
 *   this is its canonical production source.
 *
 * No Huawei call, no telemetry write. Read-only.
 *
 * ## Reference-PV completeness
 *
 * Chomakovtsi's `DeviceTelemetry` starts 2026-01-01; a load profile that
 * begins earlier has months with no reference production at all. Handling
 * (see `simulate.ts` "Missing data"):
 *   - a calendar day (reference timezone) with **no** non-null production
 *     bucket → every interval that day is `no_reference_pv`: load-side
 *     figures still recorded, PV-side left null and excluded from PV totals
 *     and from the rate denominators.
 *   - within a covered day, an individual null bucket (night / a brief
 *     inverter gap) → `referencePvKwh = 0` (a real "no production"), which
 *     simulates normally.
 */

import { floorToInterval } from "@/lib/market-price/provider";
import { getPlantProductionEnergySeries } from "@/lib/telemetry/energy-metrics";
import { formatWallClockTimestamp } from "@/lib/reporting/export-shared";

import type { ReferencePlant } from "./reference-plant";
import {
  runSimulation,
  type SimulationInputInterval,
  type SimulationMode,
  type SimulationResult,
} from "./simulate";

const STEP_MS = 15 * 60 * 1000;

export type GenerateSimulationParams = {
  referencePlant: ReferencePlant;
  loadIntervals: SimulationInputInterval[];
  targetCapacityKwp: number;
  mode: SimulationMode;
  /** Optional inclusive restriction of the simulation window (UTC instants). */
  restrictStartUtc?: Date;
  restrictEndUtc?: Date;
};

export type GenerateSimulationOutcome = {
  result: SimulationResult;
  /** The restricted interval window actually simulated. */
  windowStartUtc: Date;
  windowEndUtc: Date;
  referenceProductionRangeUtc: { start: Date; end: Date };
};

export async function generateSimulation(
  params: GenerateSimulationParams,
): Promise<GenerateSimulationOutcome> {
  const { referencePlant, mode, targetCapacityKwp } = params;
  const timeZone = referencePlant.timezone;

  let intervals = params.loadIntervals;
  if (params.restrictStartUtc) {
    const s = params.restrictStartUtc.getTime();
    intervals = intervals.filter((iv) => iv.intervalStartUtc.getTime() >= s);
  }
  if (params.restrictEndUtc) {
    const e = params.restrictEndUtc.getTime();
    intervals = intervals.filter((iv) => iv.intervalStartUtc.getTime() < e);
  }

  if (intervals.length === 0) {
    // Nothing to simulate in the restricted window — return an empty result rather than throwing.
    const now = new Date();
    return {
      result: runSimulation([], { targetCapacityKwp, referenceCapacityKwp: referencePlant.referenceCapacityKwp, mode }, timeZone),
      windowStartUtc: now,
      windowEndUtc: now,
      referenceProductionRangeUtc: { start: now, end: now },
    };
  }

  const windowStartUtc = floorToInterval(intervals[0]!.intervalStartUtc, 15);
  const windowEndUtc = new Date(
    floorToInterval(intervals[intervals.length - 1]!.intervalStartUtc, 15).getTime() + STEP_MS,
  );

  // One range read of the reference plant's canonical per-interval production.
  const production = await getPlantProductionEnergySeries(
    referencePlant.id,
    windowStartUtc,
    windowEndUtc,
  );

  const producedByMs = new Map<number, number | null>();
  const coveredDays = new Set<string>();
  for (const point of production) {
    producedByMs.set(point.intervalStart.getTime(), point.producedKwh);
    if (point.producedKwh !== null) {
      coveredDays.add(formatWallClockTimestamp(point.intervalStart, timeZone).slice(0, 10));
    }
  }

  const withReferencePv: SimulationInputInterval[] = intervals.map((iv) => {
    const day = iv.localLabel.slice(0, 10);
    if (!coveredDays.has(day)) {
      return { ...iv, referencePvKwh: null };
    }
    const produced = producedByMs.get(iv.intervalStartUtc.getTime());
    // Covered day: a null bucket is a genuine "no production" (night / brief gap) → 0.
    return { ...iv, referencePvKwh: produced == null ? 0 : produced };
  });

  const result = runSimulation(
    withReferencePv,
    { targetCapacityKwp, referenceCapacityKwp: referencePlant.referenceCapacityKwp, mode },
    timeZone,
  );

  return {
    result,
    windowStartUtc,
    windowEndUtc,
    referenceProductionRangeUtc: { start: windowStartUtc, end: windowEndUtc },
  };
}
