import type { MarketPricePoint } from "@/app/[locale]/(platform)/market/market-data";
import { dbMarketPriceProvider } from "@/lib/market-price/provider";
import { computeExportRevenue, type RevenueSummary } from "@/lib/market-price/revenue";
import { prisma } from "@/lib/prisma";
import {
  getPlantSettlementEnergySeries,
  getPlantTelemetrySeries,
  integrateKwh,
  sumSettlementEnergy,
  SETTLEMENT_INTERVAL_MINUTES,
  type SettlementEnergyPoint,
} from "@/lib/telemetry/energy-metrics";
import { getPlantTopology, type PlantTopology } from "@/lib/telemetry/plant-topology";

/**
 * Digital Twin's Simulation Engine (ADR-018). A reusable library, no UI.
 * Operates at native telemetry resolution (5-minute intervals) - the
 * highest resolution historical data Voltessa has - then aggregates the
 * simulated result into the existing 15-minute settlement grid before
 * handing off to the unchanged Revenue Engine.
 *
 * One pipeline, no topology branch anywhere in the simulation itself:
 *
 * 1. Load historical 5-minute data (native telemetry: `getPlantTelemetrySeries`
 *    for production, `getPlantSettlementEnergySeries` at 5-minute
 *    granularity for export/import - both already-existing functions,
 *    called with different parameters, not reimplemented).
 * 2. Build the historical consumption profile ONCE, independent of any
 *    scenario - Producer's consumption is always 0 (an axiom: no meter
 *    exists to reconstruct anything from); Prosumer's is reconstructed via
 *    `historicalProduction - historicalExport + historicalImport`. This is
 *    the ONLY place topology is consulted.
 * 3. Run the scenario: `newProduction = historicalProduction × capacityFactor`,
 *    `balance = newProduction - historicalConsumption`, `export`/`import`
 *    from the sign of `balance`. Identical code path for every plant -
 *    Producer and Prosumer differ only in the Step 2 input, never in this
 *    step's logic.
 * 4. Aggregate the simulated 5-minute export/import into 15-minute
 *    settlement blocks (sum).
 * 5. Feed those blocks into the existing, unchanged Revenue Engine
 *    (`sumSettlementEnergy`/`computeExportRevenue`).
 */

export type CapacityScenario = {
  type: "capacity";
  /** The hypothetical new installed capacity, kWp. */
  newCapacityKw: number;
};

/** Step 2's output - the immutable historical input every capacity factor evaluated afterward shares. */
export type HistoricalInterval = {
  intervalStart: Date;
  historicalProduction: number | null;
  historicalConsumption: number | null;
};

/** Step 3's output, at native 5-minute resolution. */
export type ScenarioInterval = {
  intervalStart: Date;
  newProduction: number | null;
  newExport: number | null;
  newImport: number | null;
};

export type ReplayTotals = {
  productionKwh: number;
  exportedKwh: number;
  importedKwh: number;
};

export type ReplayOutcome = {
  topology: PlantTopology;
  /** Native 5-minute simulated intervals. */
  intervals: ScenarioInterval[];
  totals: ReplayTotals;
  revenue: RevenueSummary;
};

const NATIVE_INTERVAL_MINUTES = 5;

function sumNullable(values: Array<number | null>): number {
  return Math.round(values.reduce((sum: number, v) => sum + (v ?? 0), 0) * 100) / 100;
}

/**
 * Battery Simulation milestone: exported, unchanged, so
 * `lib/digital-twin/battery-replay-engine.ts` reuses this exact price-shape
 * adapter instead of a third copy (the Digital Twin UI's own actions.ts
 * already has one duplicate of this same six-line mapping).
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
 * Step 1 + Step 2. Loads native 5-minute telemetry and reconstructs the
 * historical consumption profile exactly once. No scenario is considered
 * here - this is data preparation, immutable for every capacity factor
 * evaluated afterward.
 */
/**
 * Battery Simulation milestone: exported, unchanged, so the Battery
 * Engine's Available PV reconstruction (`lib/digital-twin/
 * available-pv-reconstruction.ts`) reuses this exact historical-telemetry
 * loading/consumption-reconstruction step instead of a second
 * implementation. The Battery Engine calls this with a WIDENED date range
 * (beyond the requested simulation period) purely to have enough
 * neighbouring days available for reconstruction - this function itself is
 * untouched and has no idea a battery scenario exists.
 */
export async function buildHistoricalIntervals(
  plantId: string,
  start: Date,
  end: Date,
): Promise<{ topology: PlantTopology; intervals: HistoricalInterval[] }> {
  const topology = await getPlantTopology(plantId);
  const rawSeries = await getPlantTelemetrySeries(plantId, start, end);

  // Consecutive real-sample pairs - each pair is one native 5-minute
  // interval, [previous.timestamp, current.timestamp).
  const pairs: Array<{ previous: (typeof rawSeries)[number]; current: (typeof rawSeries)[number] }> = [];
  for (let i = 1; i < rawSeries.length; i += 1) {
    const previous = rawSeries[i - 1];
    const current = rawSeries[i];
    if (previous && current) {
      pairs.push({ previous, current });
    }
  }

  if (topology === "Producer") {
    const intervals: HistoricalInterval[] = pairs.map(({ previous, current }) => {
      const historicalProduction =
        previous.productionKw !== null
          ? integrateKwh([
              { timestamp: previous.timestamp, kw: previous.productionKw },
              { timestamp: current.timestamp, kw: current.productionKw },
            ])
          : null;

      return { intervalStart: previous.timestamp, historicalProduction, historicalConsumption: 0 };
    });

    return { topology, intervals };
  }

  // Prosumer: export/import at native 5-minute granularity, via the same
  // counter-lookup function already used at 15-minute granularity elsewhere
  // - a forward counter lookup is valid at any interval width, unlike
  // power integration (see this module's own investigation record).
  const settlement5 = await getPlantSettlementEnergySeries(plantId, start, end, NATIVE_INTERVAL_MINUTES);
  const settlementByTime = new Map(settlement5.map((point) => [point.intervalStart.getTime(), point]));

  const intervals: HistoricalInterval[] = pairs.map(({ previous, current }) => {
    const historicalProduction =
      previous.productionKw !== null
        ? integrateKwh([
            { timestamp: previous.timestamp, kw: previous.productionKw },
            { timestamp: current.timestamp, kw: current.productionKw },
          ])
        : null;

    // The settlement bucket [previous.timestamp, current.timestamp) is
    // keyed by its start - the same instant this pair's production
    // integration also starts from, so both describe the identical window.
    const settlement = settlementByTime.get(previous.timestamp.getTime()) ?? null;
    const historicalExport = settlement?.exportedKwh ?? null;
    const historicalImport = settlement?.importedKwh ?? null;

    const historicalConsumption =
      historicalProduction !== null && historicalExport !== null && historicalImport !== null
        ? historicalProduction - historicalExport + historicalImport
        : null;

    return { intervalStart: previous.timestamp, historicalProduction, historicalConsumption };
  });

  return { topology, intervals };
}

/**
 * Step 3. Pure and deterministic - identical for every plant. Topology is
 * not consulted here at all; `historicalConsumption` already encodes the
 * only difference (0 for a Producer).
 */
function runCapacityScenario(intervals: HistoricalInterval[], capacityFactor: number): ScenarioInterval[] {
  return intervals.map((interval) => {
    const newProduction =
      interval.historicalProduction !== null ? interval.historicalProduction * capacityFactor : null;

    if (newProduction === null || interval.historicalConsumption === null) {
      return { intervalStart: interval.intervalStart, newProduction, newExport: null, newImport: null };
    }

    const balance = newProduction - interval.historicalConsumption;

    return {
      intervalStart: interval.intervalStart,
      newProduction,
      newExport: balance >= 0 ? balance : 0,
      newImport: balance >= 0 ? 0 : -balance,
    };
  });
}

/** Step 4. Sums native 5-minute simulated intervals into the standard 15-minute settlement grid. */
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

export async function replayCapacityScenario(params: {
  plantId: string;
  start: Date;
  end: Date;
  scenario: CapacityScenario;
}): Promise<ReplayOutcome> {
  const { plantId, start, end, scenario } = params;

  const plant = await prisma.plant.findUnique({
    where: { id: plantId },
    select: { capacityKw: true },
  });

  const currentCapacityKw = plant?.capacityKw ? Number(plant.capacityKw) : null;
  if (!currentCapacityKw) {
    throw new Error("Plant has no configured installed capacity to derive a capacity factor from");
  }

  const capacityFactor = scenario.newCapacityKw / currentCapacityKw;

  const { topology, intervals: historicalIntervals } = await buildHistoricalIntervals(plantId, start, end);
  const intervals = runCapacityScenario(historicalIntervals, capacityFactor);

  const settlementIntervals = aggregateToSettlementIntervals(intervals);

  const priceSeries = await fetchPriceSeries(start, end);
  const settlementTotals = sumSettlementEnergy(settlementIntervals);
  const revenue = computeExportRevenue(priceSeries, settlementIntervals);

  return {
    topology,
    intervals,
    totals: {
      productionKwh: sumNullable(intervals.map((i) => i.newProduction)),
      exportedKwh: settlementTotals.exportedKwh,
      importedKwh: settlementTotals.importedKwh,
    },
    revenue,
  };
}
