import type { MarketPricePoint } from "@/app/[locale]/(platform)/market/market-data";
import { reconstructAvailablePv, type AvailablePvInterval } from "@/lib/digital-twin/available-pv-reconstruction";
import { type BatteryConfig, type BatteryDispatchInterval, runBatteryDispatch } from "@/lib/digital-twin/battery-dispatch";
import { buildHistoricalIntervals } from "@/lib/digital-twin/historical-intervals";
import { dbMarketPriceProvider } from "@/lib/market-price/provider";
import { computeExportRevenue, type RevenueSummary } from "@/lib/market-price/revenue";
import { prisma } from "@/lib/prisma";
import {
  sumSettlementEnergy,
  SETTLEMENT_INTERVAL_MINUTES,
  type SettlementEnergyPoint,
} from "@/lib/telemetry/energy-metrics";
import { getPlantTopology, type PlantTopology } from "@/lib/telemetry/plant-topology";

/**
 * Digital Twin's Simulation Engine (ADR-018), Replay Pipeline Unification
 * milestone. `replay-engine.ts` is the single orchestrator for every replay
 * - no second replay engine exists anywhere else. It executes only the
 * scenario layers the caller enables:
 *
 *   Historical Data -> Available PV Reconstruction -> Capacity Scenario (optional)
 *     -> Battery Dispatch (optional) -> Settlement Series -> Revenue Engine
 *
 * Available PV Reconstruction always runs - it is a no-op for any interval
 * that was never curtailed (see `available-pv-reconstruction.ts`), and
 * genuinely corrects the input for periods that were. Capacity Scenario and
 * Battery Dispatch are each independently optional; "capacity + battery" is
 * not a third code path - `runBatteryDispatch` already accepts a
 * `capacityFactor`, so battery-only and capacity+battery are the exact same
 * call, just with a different factor.
 *
 * The no-battery path (no scenario, or capacity-only) reuses
 * `runCapacityScenario`/`aggregateToSettlementIntervals` completely
 * unchanged from before this milestone - same native-5-minute balance
 * computation, same aggregation-after-the-fact - so its numeric output stays
 * byte-identical to the pre-unification implementation for any period with
 * no curtailment. It intentionally does NOT go through the battery path's
 * aggregate-before-compute order, because summing a per-interval
 * `max(0, ...)` balance is not the same as clamping a summed balance
 * whenever the sign flips within an aggregation window.
 *
 * The battery path (Zero-Export dispatch fix) now dispatches on
 * `reconstructAvailablePv`'s native 5-minute timeline directly -
 * `runBatteryDispatch` itself derives the correct power-limit math from
 * that native spacing (see its own doc comment). 15-minute aggregation
 * happens only afterward, to build the settlement series the Revenue
 * Engine needs (`aggregateDispatchToSettlementIntervals`, mirroring the
 * no-battery path's own `aggregateToSettlementIntervals`) - `ReplayOutcome
 * .intervals` itself stays native 5-minute for both paths now, consistent
 * with `actions.ts`'s own `aggregateNativeIntervalsTo15Min` already
 * expecting a native-resolution input regardless of scenario.
 */

export type CapacityScenarioConfig = {
  /** The hypothetical new installed capacity, kWp. */
  newCapacityKw: number;
};

export type ReplayScenario = {
  capacityScenario?: CapacityScenarioConfig;
  batteryScenario?: BatteryConfig;
};

/** Capacity Scenario step's output, at native 5-minute resolution (no-battery path only). */
export type ScenarioInterval = {
  intervalStart: Date;
  newProduction: number | null;
  newExport: number | null;
  newImport: number | null;
};

/**
 * The single per-interval shape `ReplayOutcome.intervals` returns,
 * regardless of which layers ran. Native 5-minute resolution for both
 * paths (Zero-Export dispatch fix) - the battery path no longer aggregates
 * to 15 minutes before returning its own intervals; that aggregation now
 * happens only for the separate settlement series fed to the Revenue
 * Engine (see `aggregateDispatchToSettlementIntervals`).
 */
export type ReplayIntervalOutcome = {
  intervalStart: Date;
  productionKwh: number | null;
  availablePvKwh: number | null;
  consumptionKwh: number | null;
  exportedKwh: number | null;
  importedKwh: number | null;
  chargeKwh: number | null;
  dischargeKwh: number | null;
  /** Zero-Export dispatch fix. Null when no battery scenario was run. */
  mandatoryChargeKwh: number | null;
  /** Zero-Export dispatch fix. Null when no battery scenario was run. */
  curtailedKwh: number | null;
  /**
   * Available-PV chart semantics fix. Whether Voltessa's own automation had
   * this plant in Zero Export at this interval - threaded straight from
   * `AvailablePvInterval.isZeroExport` (`available-pv-reconstruction.ts`),
   * the actual historical Zero-Export constraint, never inferred from price/
   * export/production/time-of-day. The one property that lets a caller
   * distinguish "this interval's `availablePvKwh` differs from historical
   * production because Zero Export forced a reconstruction" from "PV surplus
   * simply wasn't exported due to self-consumption" - see
   * `app/admin/digital-twin/actions.ts`'s `computeAdditionalAvailablePvKwh`.
   */
  isZeroExport: boolean;
  socKwh: number | null;
};

export type ReplayTotals = {
  /** Post-capacity-scaling total PV production. */
  productionKwh: number;
  /** Pre-capacity-scaling, curtailment-corrected available PV. Equal to productionKwh when no capacity scenario is applied. */
  availablePvKwh: number;
  consumptionKwh: number;
  exportedKwh: number;
  importedKwh: number;
};

export type ReplayBatteryTotals = {
  chargedEnergyKwh: number;
  dischargedEnergyKwh: number;
  batteryLossesKwh: number;
  throughputKwh: number;
  finalSocKwh: number;
  peakSocKwh: number;
};

export type ReplayOutcome = {
  topology: PlantTopology;
  totals: ReplayTotals;
  /** null when no battery scenario was run. */
  battery: ReplayBatteryTotals | null;
  revenue: RevenueSummary;
  intervals: ReplayIntervalOutcome[];
};

function sumNullable(values: Array<number | null>): number {
  return Math.round(values.reduce((sum: number, v) => sum + (v ?? 0), 0) * 100) / 100;
}

/**
 * Exported, unchanged, so `battery-engine-report.ts`'s diagnostics can fetch
 * the same price series the replay itself used, independent of a scenario
 * result.
 */
export async function fetchPriceSeries(start: Date, end: Date): Promise<MarketPricePoint[]> {
  const result = await dbMarketPriceProvider.getPricesInRange({ start, end });
  if (!result.available) {
    return [];
  }

  return result.prices.map((row) => ({
    timestamp: row.timestamp,
    price: row.price,
    // Not a real decision - the replay engine never renders a threshold
    // line, and computeExportRevenue never reads this field. Present only
    // because it replays through the exact MarketPricePoint type Market
    // itself uses, unchanged.
    exportEnabled: false,
  }));
}

/**
 * Capacity Scenario step. Pure and deterministic - identical for every
 * plant. Topology is not consulted here at all; `consumptionKwh` already
 * encodes the only difference (0 for a Producer). Unchanged formula from
 * before this milestone - only the input type changed, from raw
 * `HistoricalInterval` to post-reconstruction `AvailablePvInterval`, since
 * Available PV Reconstruction now always runs first.
 */
function runCapacityScenario(intervals: AvailablePvInterval[], capacityFactor: number): ScenarioInterval[] {
  return intervals.map((interval) => {
    const newProduction = interval.availablePvKwh !== null ? interval.availablePvKwh * capacityFactor : null;

    if (newProduction === null || interval.consumptionKwh === null) {
      return { intervalStart: interval.intervalStart, newProduction, newExport: null, newImport: null };
    }

    const balance = newProduction - interval.consumptionKwh;

    return {
      intervalStart: interval.intervalStart,
      newProduction,
      newExport: balance >= 0 ? balance : 0,
      newImport: balance >= 0 ? 0 : -balance,
    };
  });
}

/** Sums native 5-minute simulated intervals into the standard 15-minute settlement grid. */
function aggregateToSettlementIntervals(intervals: ScenarioInterval[]): SettlementEnergyPoint[] {
  const bucketMs = SETTLEMENT_INTERVAL_MINUTES * 60 * 1000;
  const buckets = new Map<number, { exportedKwh: number | null; importedKwh: number | null }>();

  for (const interval of intervals) {
    const bucketStart = Math.floor(interval.intervalStart.getTime() / bucketMs) * bucketMs;
    const existing = buckets.get(bucketStart) ?? { exportedKwh: null, importedKwh: null };

    buckets.set(bucketStart, {
      exportedKwh:
        interval.newExport !== null ? (existing.exportedKwh ?? 0) + interval.newExport : existing.exportedKwh,
      importedKwh:
        interval.newImport !== null ? (existing.importedKwh ?? 0) + interval.newImport : existing.importedKwh,
    });
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, v]) => ({ intervalStart: new Date(t), exportedKwh: v.exportedKwh, importedKwh: v.importedKwh }));
}

async function replayNoBattery(params: {
  plantId: string;
  organizationId: string;
  start: Date;
  end: Date;
  capacityFactor: number;
}): Promise<ReplayOutcome> {
  const { plantId, organizationId, start, end, capacityFactor } = params;

  const [{ topology, intervals: historicalIntervals }, availablePvWide, priceSeries] = await Promise.all([
    buildHistoricalIntervals(plantId, start, end),
    reconstructAvailablePv({ plantId, organizationId, start, end }),
    fetchPriceSeries(start, end),
  ]);

  // reconstructAvailablePv widens its own query range (up to ±30 days) to
  // have neighbour days available for curtailment correction, and derives
  // its own [start, end) interval set independently from that wider query -
  // which can legitimately include one boundary interval buildHistoricalIntervals's
  // own narrow [start, end) query would not have had a "next" sample to
  // pair with and form. Re-keying onto buildHistoricalIntervals's own
  // interval set (queried at the exact requested range, unchanged from
  // before this milestone) guarantees the exact same interval count/set as
  // the pre-unification implementation - required for byte-identical
  // capacity-only output - while still picking up curtailment-corrected
  // values wherever reconstruction actually changed one.
  const availablePvByTime = new Map(availablePvWide.map((interval) => [interval.intervalStart.getTime(), interval]));
  const availablePv: AvailablePvInterval[] = historicalIntervals.map((interval) => {
    const corrected = availablePvByTime.get(interval.intervalStart.getTime());
    return (
      corrected ?? {
        intervalStart: interval.intervalStart,
        availablePvKwh: interval.historicalProduction,
        consumptionKwh: interval.historicalConsumption,
        isZeroExport: false,
      }
    );
  });

  // "Current (historical)" reporting fix. `capacityFactor === 1` means no
  // capacity scenario was actually requested (`actions.ts`'s "Current" call
  // always passes `newCapacityKw: currentCapacityKw`) - there is nothing
  // hypothetical to compute, so this must report exactly what actually
  // happened: the real historical export/import (`historicalExportKwh`/
  // `historicalImportKwh`, straight from the meter's counter difference),
  // never `runCapacityScenario`'s production/consumption balance. That
  // balance recompute is correct and necessary for a genuine capacity
  // resize (a differently-sized plant's export can't just be last year's
  // real number), but at factor 1 it silently let Zero-Export's
  // reconstructed availablePvKwh (intentionally LARGER than what was
  // physically exported, during Zero Export) leak into "Current"'s own
  // reported export/production/revenue - inflating them far past the real
  // historical figures the Market page shows for the same day.
  const scenarioIntervals: ScenarioInterval[] =
    capacityFactor === 1
      ? historicalIntervals.map((interval) => ({
          intervalStart: interval.intervalStart,
          newProduction: interval.historicalProduction,
          newExport: interval.historicalExportKwh,
          newImport: interval.historicalImportKwh,
        }))
      : runCapacityScenario(availablePv, capacityFactor);
  const settlementIntervals = aggregateToSettlementIntervals(scenarioIntervals);
  const settlementTotals = sumSettlementEnergy(settlementIntervals);
  const revenue = computeExportRevenue(priceSeries, settlementIntervals);

  const intervals: ReplayIntervalOutcome[] = scenarioIntervals.map((interval, index) => ({
    intervalStart: interval.intervalStart,
    productionKwh: interval.newProduction,
    availablePvKwh: availablePv[index]?.availablePvKwh ?? null,
    consumptionKwh: availablePv[index]?.consumptionKwh ?? null,
    exportedKwh: interval.newExport,
    importedKwh: interval.newImport,
    chargeKwh: null,
    dischargeKwh: null,
    mandatoryChargeKwh: null,
    curtailedKwh: null,
    socKwh: null,
    isZeroExport: availablePv[index]?.isZeroExport ?? false,
  }));

  return {
    topology,
    totals: {
      productionKwh: sumNullable(scenarioIntervals.map((i) => i.newProduction)),
      availablePvKwh: sumNullable(availablePv.map((i) => i.availablePvKwh)),
      consumptionKwh: sumNullable(availablePv.map((i) => i.consumptionKwh)),
      exportedKwh: settlementTotals.exportedKwh,
      importedKwh: settlementTotals.importedKwh,
    },
    battery: null,
    revenue,
    intervals,
  };
}

/**
 * Zero-Export dispatch fix. `runBatteryDispatch` now runs on the native
 * (5-minute) `AvailablePvInterval` timeline directly - this sums that
 * native-resolution dispatch output into the standard 15-minute settlement
 * grid, exactly mirroring `aggregateToSettlementIntervals`'s own bucketing
 * for the no-battery path, so `computeExportRevenue` (which resolves each
 * settlement point against the 15-minute ENTSO-E price series) still gets
 * correctly-aligned input. `ReplayOutcome.intervals` itself is built
 * separately, directly from the native `dispatch` array - this function
 * exists only to feed the Revenue Engine.
 */
function aggregateDispatchToSettlementIntervals(dispatch: BatteryDispatchInterval[]): SettlementEnergyPoint[] {
  const bucketMs = SETTLEMENT_INTERVAL_MINUTES * 60 * 1000;
  const buckets = new Map<number, { exportedKwh: number; importedKwh: number }>();

  for (const interval of dispatch) {
    const bucketStart = Math.floor(interval.intervalStart.getTime() / bucketMs) * bucketMs;
    const existing = buckets.get(bucketStart) ?? { exportedKwh: 0, importedKwh: 0 };

    buckets.set(bucketStart, {
      exportedKwh: existing.exportedKwh + interval.exportedKwh,
      importedKwh: existing.importedKwh + interval.importedKwh,
    });
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, v]) => ({ intervalStart: new Date(t), exportedKwh: v.exportedKwh, importedKwh: v.importedKwh }));
}

async function replayWithBattery(params: {
  plantId: string;
  organizationId: string;
  start: Date;
  end: Date;
  capacityFactor: number;
  batteryScenario: BatteryConfig;
}): Promise<ReplayOutcome> {
  const { plantId, organizationId, start, end, capacityFactor, batteryScenario } = params;

  const [topology, nativeAvailablePv, priceSeries] = await Promise.all([
    getPlantTopology(plantId),
    reconstructAvailablePv({ plantId, organizationId, start, end }),
    fetchPriceSeries(start, end),
  ]);

  const dispatch: BatteryDispatchInterval[] = runBatteryDispatch(nativeAvailablePv, capacityFactor, priceSeries, batteryScenario);

  const settlementIntervals = aggregateDispatchToSettlementIntervals(dispatch);
  const revenue = computeExportRevenue(priceSeries, settlementIntervals);

  const intervals: ReplayIntervalOutcome[] = dispatch.map((interval, index) => ({
    intervalStart: interval.intervalStart,
    // dispatch.availablePvKwh is already capacity-scaled (runBatteryDispatch's own output contract) - this is "production", the post-scaling PV.
    productionKwh: interval.availablePvKwh,
    availablePvKwh: nativeAvailablePv[index]?.availablePvKwh ?? null,
    consumptionKwh: interval.consumptionKwh,
    exportedKwh: interval.exportedKwh,
    importedKwh: interval.importedKwh,
    chargeKwh: interval.chargeKwh,
    dischargeKwh: interval.dischargeKwh,
    mandatoryChargeKwh: interval.mandatoryChargeKwh,
    curtailedKwh: interval.curtailedKwh,
    socKwh: interval.socKwh,
    isZeroExport: nativeAvailablePv[index]?.isZeroExport ?? false,
  }));

  const eta = Math.sqrt(batteryScenario.roundTripEfficiencyPercent / 100);
  const chargedEnergyKwh = sumNullable(dispatch.map((i) => i.chargeKwh));
  const dischargedEnergyKwh = sumNullable(dispatch.map((i) => i.dischargeKwh));
  const batteryLossesKwh =
    Math.round(dispatch.reduce((sum, i) => sum + i.chargeKwh * (1 - eta) + i.dischargeKwh * (1 / eta - 1), 0) * 100) / 100;
  const throughputKwh = Math.round((chargedEnergyKwh + dischargedEnergyKwh) * 100) / 100;
  const finalSocKwh = dispatch.length > 0 ? dispatch[dispatch.length - 1]!.socKwh : 0;
  const peakSocKwh = dispatch.length > 0 ? Math.max(...dispatch.map((i) => i.socKwh)) : 0;

  return {
    topology,
    totals: {
      productionKwh: sumNullable(dispatch.map((i) => i.availablePvKwh)),
      availablePvKwh: sumNullable(nativeAvailablePv.map((i) => i.availablePvKwh)),
      consumptionKwh: sumNullable(dispatch.map((i) => i.consumptionKwh)),
      exportedKwh: sumNullable(dispatch.map((i) => i.exportedKwh)),
      importedKwh: sumNullable(dispatch.map((i) => i.importedKwh)),
    },
    battery: { chargedEnergyKwh, dischargedEnergyKwh, batteryLossesKwh, throughputKwh, finalSocKwh, peakSocKwh },
    revenue,
    intervals,
  };
}

/** The single replay entry point. Executes only the scenario layers `scenario` enables. */
export async function replay(params: {
  plantId: string;
  start: Date;
  end: Date;
  scenario: ReplayScenario;
}): Promise<ReplayOutcome> {
  const { plantId, start, end, scenario } = params;

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

  const capacityFactor = scenario.capacityScenario ? scenario.capacityScenario.newCapacityKw / currentCapacityKw : 1;

  if (scenario.batteryScenario) {
    return replayWithBattery({
      plantId,
      organizationId: plant.organizationId,
      start,
      end,
      capacityFactor,
      batteryScenario: scenario.batteryScenario,
    });
  }

  return replayNoBattery({ plantId, organizationId: plant.organizationId, start, end, capacityFactor });
}
