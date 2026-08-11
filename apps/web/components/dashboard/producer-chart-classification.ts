/**
 * Dashboard Forecast Semantics & Measurement Accuracy milestone. Decides
 * whether `LiveEnergyChart` should render/legend the three grid-flow series
 * (Total Consumption, Import from Grid, Fed to Grid) for the CURRENTLY
 * DISPLAYED period's data — extracted out of `LiveEnergyChart.tsx` into a
 * pure function so it can be unit-tested without a browser/Recharts (see
 * `e2e/forecast-bucket-aggregation.spec.ts`'s own top doc comment for why
 * this repo's Playwright suite hosts pure-function tests like this one).
 *
 * This is deliberately NOT the same signal as `lib/telemetry/plant-
 * topology.ts`'s `getPlantTopology` (ADR-018, ID plant Prosumer/Producer by
 * meter *hardware* presence) — that signal answers "does this plant have a
 * real meter device" and stays exactly as-is for every other consumer
 * (KPI cards, `EnergyFlowDiagram`, `getCurrentGridReadings`'s export
 * fallback). This module answers a narrower, chart-display-only question:
 * "does this plant's meter show a genuinely meaningful LOAD, or is a
 * present-but-load-free meter's residual reading just noise." A plant can
 * have a real meter (ADR-018 "Prosumer") and still correctly render as
 * producer-only here if that meter's grid import never amounts to a real
 * fraction of the plant's own production.
 *
 * Evidence behind the threshold (Aug 2026 investigation): Atlanta has a
 * real meter with large, spiky INSTANTANEOUS import readings (up to ~114 kW
 * during transient cloud/automation events) that make any raw-kW "noise
 * floor" useless as a discriminator — but its TOTAL imported energy over a
 * full day is consistently 7.6%-16.6% of that same day's production
 * (18-152 kWh/day, sampled across six real August days) — genuine,
 * substantial site load, not meter noise, by any reasonable reading of the
 * word "noise." `GRID_IMPORT_NOISE_RATIO_THRESHOLD` is set an order of
 * magnitude below that observed floor specifically so Atlanta's own real
 * data continues to classify it as having meaningful grid data (all three
 * series shown) — this module does not hide Atlanta's real consumption; it
 * exists to correctly hide a plant whose import ratio is genuinely
 * negligible, which Atlanta's is not.
 */

export const GRID_IMPORT_NOISE_RATIO_THRESHOLD = 0.02;

export type ChartFlowPointLike = {
  pvKw: number | null;
  consumptionKw: number | null;
};

/**
 * Ratio-based, not presence-based: a plant with a real meter device still
 * has SOME non-null consumption/import/export readings at almost every real
 * telemetry sample (see this module's own top doc comment on why raw
 * presence/instantaneous-kW checks don't work) — the only reliable signal
 * is total consumption energy over the displayed period as a fraction of
 * total PV energy over that same period. `Δt` cancels out of this ratio as
 * long as every point in `data` shares the same sampling interval (true for
 * both the Today 5-minute grid and the Week/Month per-day kWh buckets), so
 * this never needs to know or assume that interval.
 */
export function hasMeaningfulGridData(data: ChartFlowPointLike[]): boolean {
  let totalPv = 0;
  let totalConsumption = 0;
  for (const point of data) {
    totalPv += point.pvKw ?? 0;
    totalConsumption += point.consumptionKw ?? 0;
  }
  if (totalPv <= 0) {
    return false;
  }
  return totalConsumption / totalPv > GRID_IMPORT_NOISE_RATIO_THRESHOLD;
}
