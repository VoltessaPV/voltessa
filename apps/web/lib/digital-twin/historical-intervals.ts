import {
  getPlantSettlementEnergySeries,
  getPlantTelemetrySeries,
  integrateKwh,
} from "@/lib/telemetry/energy-metrics";
import { getPlantTopology, type PlantTopology } from "@/lib/telemetry/plant-topology";

/**
 * Replay pipeline's Step 0/1a - raw historical telemetry loading, at native
 * 5-minute resolution. Extracted out of `replay-engine.ts` (Replay Pipeline
 * Unification milestone) into its own module specifically to avoid a
 * circular import: `replay-engine.ts` is the orchestrator and now depends on
 * `available-pv-reconstruction.ts` (Step 1b), which has always depended on
 * this loading step - both sides need it, neither should depend on the
 * other for it.
 */

/** This step's output - the immutable historical input every later pipeline stage shares. */
export type HistoricalInterval = {
  intervalStart: Date;
  historicalProduction: number | null;
  historicalConsumption: number | null;
};

const NATIVE_INTERVAL_MINUTES = 5;

/**
 * Loads native 5-minute telemetry and reconstructs the historical
 * consumption profile exactly once. No scenario is considered here - this
 * is data preparation, immutable for every scenario evaluated afterward.
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
