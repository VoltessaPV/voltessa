import { buildHistoricalIntervals } from "@/lib/digital-twin/historical-intervals";
import { getAutomationModeTimeline, isZeroExportAt } from "@/lib/digital-twin/automation-mode-timeline";

/**
 * Battery Simulation milestone. The Battery Engine never works with
 * "historical production" or "reconstructed production" - only with
 * Available PV, the maximum PV energy physically available during an
 * interval. For a historical period this equals measured production for
 * every interval that wasn't curtailed, and a reconstructed estimate for
 * every interval that was (Zero Export only - see the module doc comment
 * on `reconstructAvailablePv` below for why). For a future forecast-driven
 * Automation caller, this would instead come from a PV forecast - the
 * point of this being its own type, distinct from `HistoricalInterval`, is
 * that `runBatteryDispatch` (`battery-dispatch.ts`) never has to know or
 * care which source produced it.
 */
export type AvailablePvInterval = {
  intervalStart: Date;
  availablePvKwh: number | null;
  consumptionKwh: number | null;
  /**
   * Zero-Export dispatch fix. Whether Voltessa's own automation had this
   * plant in Zero Export mode at this instant - threaded through from the
   * same `isLimitedAt`/`isZeroExportAt` check this function already runs
   * internally to decide whether to reconstruct, rather than discarding it.
   * `runBatteryDispatch` (`battery-dispatch.ts`) needs this to distinguish
   * curtailed-and-physically-blocked-from-export PV from ordinary
   * freely-exportable PV surplus.
   */
  isZeroExport: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const NEIGHBOR_WINDOW_DAYS = 3;
const MAX_FALLBACK_WINDOW_DAYS = 30;

/**
 * Available PV reconstruction (Battery Simulation milestone).
 *
 * Historical production is not always the available PV: when Voltessa's
 * own automation switched the plant to Zero Export, production was
 * intentionally curtailed and no longer reflects what the panels could
 * physically have produced. Only Zero Export is reconstructable in V1 - a
 * partial "Export Limit" (a specific kW cap) has no persisted historical
 * record anywhere in this schema; it exists only as a manual, never-stored
 * Automation Lab action, not something the automated scheduler has ever
 * run. This function does not attempt to detect or correct for it.
 *
 * For every limited interval: look at the same local time-of-day on the
 * ±3 surrounding calendar days, exclude any of those days where that same
 * interval was ALSO limited, and average the remaining real production
 * values. If none of the ±3 days survive that exclusion, widen the search
 * outward (day by day, both directions) up to ±30 days and take the
 * single temporally nearest valid day instead of an average. If nothing
 * valid exists anywhere in that window (automation curtailed continuously
 * for a month or more), fall back to the curtailed measurement itself
 * rather than fabricating a number - this is the one case where the
 * reconstruction gives up, and it should be rare in practice.
 *
 * Deliberately no weather/clear-sky model anywhere in this function - every
 * value that comes out of it is real historical telemetry from this exact
 * plant, nothing synthetic. "Same local time of day" is approximated as
 * "exactly N × 24h away in UTC" rather than full timezone-aware wall-clock
 * arithmetic - correct year-round except across the twice-yearly DST
 * transition, where a candidate day can be off by up to an hour. Accepted
 * as a deliberate V1 simplification, consistent with the same "whole-hour
 * offset" reasoning `lib/market-price/chart-aggregation.ts` already relies
 * on for its own hourly bucketing.
 *
 * Topology-agnostic by construction - a Producer plant's Zero Export
 * curtails production itself toward zero (no meter to shunt surplus into),
 * so the identical neighbor-day averaging recovers the true available PV
 * the same way it does for a Prosumer. No branch needed here, matching the
 * existing Replay Engine's own principle that topology only ever changes
 * the *consumption* input, never the mechanics around it.
 */
export async function reconstructAvailablePv(params: {
  plantId: string;
  organizationId: string;
  start: Date;
  end: Date;
}): Promise<AvailablePvInterval[]> {
  const { plantId, organizationId, start, end } = params;

  const widenedStart = new Date(start.getTime() - MAX_FALLBACK_WINDOW_DAYS * DAY_MS);
  const widenedEnd = new Date(end.getTime() + MAX_FALLBACK_WINDOW_DAYS * DAY_MS);

  const [{ intervals: widenedIntervals }, modeTimeline] = await Promise.all([
    buildHistoricalIntervals(plantId, widenedStart, widenedEnd),
    getAutomationModeTimeline(organizationId, widenedStart, widenedEnd),
  ]);

  const productionByTime = new Map(widenedIntervals.map((interval) => [interval.intervalStart.getTime(), interval.historicalProduction]));

  function productionAt(instant: Date): number | null {
    return productionByTime.get(instant.getTime()) ?? null;
  }

  function isLimitedAt(instant: Date): boolean {
    return isZeroExportAt(modeTimeline, instant);
  }

  const targetIntervals = widenedIntervals.filter(
    (interval) => interval.intervalStart.getTime() >= start.getTime() && interval.intervalStart.getTime() < end.getTime(),
  );

  return targetIntervals.map((interval): AvailablePvInterval => {
    if (!isLimitedAt(interval.intervalStart)) {
      return {
        intervalStart: interval.intervalStart,
        availablePvKwh: interval.historicalProduction,
        consumptionKwh: interval.historicalConsumption,
        isZeroExport: false,
      };
    }

    const nearCandidates: number[] = [];
    for (let offset = -NEIGHBOR_WINDOW_DAYS; offset <= NEIGHBOR_WINDOW_DAYS; offset += 1) {
      if (offset === 0) {
        continue;
      }

      const candidateInstant = new Date(interval.intervalStart.getTime() + offset * DAY_MS);
      if (isLimitedAt(candidateInstant)) {
        continue;
      }

      const production = productionAt(candidateInstant);
      if (production !== null) {
        nearCandidates.push(production);
      }
    }

    if (nearCandidates.length > 0) {
      const average = nearCandidates.reduce((sum, value) => sum + value, 0) / nearCandidates.length;
      return {
        intervalStart: interval.intervalStart,
        availablePvKwh: Math.round(average * 100) / 100,
        consumptionKwh: interval.historicalConsumption,
        isZeroExport: true,
      };
    }

    for (let offset = NEIGHBOR_WINDOW_DAYS + 1; offset <= MAX_FALLBACK_WINDOW_DAYS; offset += 1) {
      for (const sign of [-1, 1] as const) {
        const candidateInstant = new Date(interval.intervalStart.getTime() + sign * offset * DAY_MS);
        if (isLimitedAt(candidateInstant)) {
          continue;
        }

        const production = productionAt(candidateInstant);
        if (production !== null) {
          return {
            intervalStart: interval.intervalStart,
            availablePvKwh: production,
            consumptionKwh: interval.historicalConsumption,
            isZeroExport: true,
          };
        }
      }
    }

    return {
      intervalStart: interval.intervalStart,
      availablePvKwh: interval.historicalProduction,
      consumptionKwh: interval.historicalConsumption,
      isZeroExport: true,
    };
  });
}
