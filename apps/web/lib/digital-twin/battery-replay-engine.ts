import { aggregateAvailablePvTo15Min, reconstructAvailablePv } from "@/lib/digital-twin/available-pv-reconstruction";
import { type BatteryConfig, type BatteryDispatchInterval, runBatteryDispatch } from "@/lib/digital-twin/battery-dispatch";
import { fetchPriceSeries } from "@/lib/digital-twin/replay-engine";
import { computeExportRevenue, type RevenueSummary } from "@/lib/market-price/revenue";
import { prisma } from "@/lib/prisma";
import { getPlantTopology, type PlantTopology } from "@/lib/telemetry/plant-topology";

/**
 * Battery Simulation milestone - orchestration only. Wires together the
 * Available PV reconstruction and Battery Dispatch Engine, then hands the
 * result to the existing, completely unchanged Revenue Engine
 * (`computeExportRevenue`). Does not import from, or modify,
 * `replay-engine.ts`'s own scenario functions (`runCapacityScenario`,
 * `aggregateToSettlementIntervals`) - the no-battery balance equation
 * those implement isn't what a battery scenario needs, so this pipeline
 * doesn't route through them at all; it only reuses the two pieces that
 * are genuinely shared (`buildHistoricalIntervals`, via
 * `reconstructAvailablePv`, and `fetchPriceSeries`).
 */

export type BatteryReplayTotals = {
  availablePvKwh: number;
  consumptionKwh: number;
  chargeKwh: number;
  dischargeKwh: number;
  exportedKwh: number;
  importedKwh: number;
};

export type BatteryReplayOutcome = {
  topology: PlantTopology;
  /** 15-minute resolution - this engine's own native dispatch resolution, matching the settlement grid. */
  intervals: BatteryDispatchInterval[];
  totals: BatteryReplayTotals;
  revenue: RevenueSummary;
};

const SUMMED_FIELDS = ["availablePvKwh", "consumptionKwh", "chargeKwh", "dischargeKwh", "exportedKwh", "importedKwh"] as const;

function sumTotals(intervals: BatteryDispatchInterval[]): BatteryReplayTotals {
  const totals = { availablePvKwh: 0, consumptionKwh: 0, chargeKwh: 0, dischargeKwh: 0, exportedKwh: 0, importedKwh: 0 };

  for (const interval of intervals) {
    for (const field of SUMMED_FIELDS) {
      totals[field] += interval[field];
    }
  }

  for (const field of SUMMED_FIELDS) {
    totals[field] = Math.round(totals[field] * 100) / 100;
  }

  return totals;
}

export async function replayBatteryScenario(params: {
  plantId: string;
  start: Date;
  end: Date;
  newCapacityKw: number;
  battery: BatteryConfig;
}): Promise<BatteryReplayOutcome> {
  const { plantId, start, end, newCapacityKw, battery } = params;

  const plant = await prisma.plant.findUnique({
    where: { id: plantId },
    select: { capacityKw: true, organizationId: true },
  });

  if (!plant) {
    throw new Error("Plant not found");
  }

  const currentCapacityKw = plant.capacityKw ? Number(plant.capacityKw) : null;
  if (!currentCapacityKw) {
    throw new Error("Plant has no configured installed capacity to derive a capacity factor from");
  }

  const capacityFactor = newCapacityKw / currentCapacityKw;

  const [topology, nativeAvailablePv, priceSeries] = await Promise.all([
    getPlantTopology(plantId),
    reconstructAvailablePv({ plantId, organizationId: plant.organizationId, start, end }),
    fetchPriceSeries(start, end),
  ]);

  const fifteenMinAvailablePv = aggregateAvailablePvTo15Min(nativeAvailablePv);
  const intervals = runBatteryDispatch(fifteenMinAvailablePv, capacityFactor, priceSeries, battery);

  const revenue = computeExportRevenue(priceSeries, intervals);

  return {
    topology,
    intervals,
    totals: sumTotals(intervals),
    revenue,
  };
}
