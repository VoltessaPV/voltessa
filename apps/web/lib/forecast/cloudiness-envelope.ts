import { reconstructAvailablePv } from "@/lib/digital-twin/available-pv-reconstruction";
import { applyHourOfDayCalibration, computeHourOfDayCalibrationUncached } from "@/lib/forecast/calibration";
import { estimatePhysicalPvKw } from "@/lib/forecast/physical-pv-model";
import { haurwitzClearSkyGhi } from "@/lib/forecast/clear-sky";
import { solarPositionAt } from "@/lib/forecast/solar-position";

/**
 * PV Generation Forecast — historical cloudiness envelope (Chomakovtsi
 * clear-sky-fallback over-forecast investigation, Aug 2026).
 *
 * The problem this exists to fix: for a day with no real weather forecast
 * (`weatherOrClearSkyFallback` uses clear-sky GHI as the physical model's
 * input) AND no valid analog-day candidates (Chomakovtsi's permanent state
 * — its ~66-67% 24h-relative telemetry coverage fails `analog-days.ts`'s
 * 80% quality gate), there is currently NOTHING to moderate the physical
 * model's inherent clear-sky optimism. The existing hour-of-day
 * `calibration.ts` factor does not help here — it is itself a real,
 * statistically-justified correction (confirmed stable at 1.316 across
 * 14/30/45/60-day lookback windows for Chomakovtsi) computed against
 * REAL historical weather, so applying it to an already-optimistic
 * clear-sky baseline only compounds the optimism rather than correcting it
 * (601.0 kWh pure clear-sky x 1.316 = 735.2 kWh, exceeding Chomakovtsi's
 * own 40-day historical maximum of 703.9 kWh for a single day).
 *
 * This module computes a SEPARATE, plant-specific ratio: what fraction of
 * its own CALIBRATED clear-sky potential does this plant typically realize
 * on a real day, given real historical weather variability (i.e. clouds).
 * Deliberately compared against CALIBRATED clear-sky (physical GHI-model
 * output run through the SAME hour-of-day calibration factor), not raw
 * clear-sky - comparing against raw clear-sky would conflate two different
 * effects (panel-orientation/tilt advantage already captured by
 * `calibration.ts`, and real-weather cloudiness) into one number, which
 * empirically produced a factor low enough to under-forecast even a
 * genuinely good day. Isolating cloudiness specifically (both sides of the
 * ratio already reflect the plant's own real characteristics) gives a
 * physically clean number: Chomakovtsi's real ~41-day median is 0.80,
 * Atlanta's is 0.83 - both a believable "typical real day realizes ~80% of
 * its own calibrated-clear-sky-day potential" reading, not an arbitrary
 * discount.
 *
 * Never used to REPLACE the physical+calibration estimate outright - only
 * to supply a second, independent magnitude signal for
 * `pv-forecast-core.ts`'s existing blend mechanism (the same one PR #80
 * already uses for analog-day magnitude), for the specific case where
 * BOTH real weather AND analog days are unavailable. A day with real
 * weather, or a day with valid analog candidates, is completely unaffected
 * by this module.
 */

const LOOKBACK_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A day needs at least this many real, non-null 5-minute Available PV samples to trust its own daily ratio — matches the rough daytime-only sample count a normal reporting day produces (well below even Chomakovtsi's own ~160-183/day observed range), so a genuinely partial/broken day is excluded without needing a fragile 24-hour-relative percentage. */
const MIN_VALID_SAMPLES_PER_DAY = 100;
/** Need at least this many qualifying days for the median to mean anything - below this, `factor` is `null` (never a value the caller could mistake for a real estimate from too little evidence). */
const MIN_DAYS_FOR_FACTOR = 5;
/** A real day's production cannot rationally exceed its own calibrated clear-sky ceiling by more than a small margin (diffuse-irradiance edge effects on partly-cloudy-but-bright days) - bounds against a single data artifact producing a factor that would let the envelope leak above the physical ceiling it's derived from. */
const MIN_FACTOR = 0.15;
const MAX_FACTOR = 1.05;

const FALLBACK_AMBIENT_TEMP_C = 20;

export type HistoricalCloudinessEnvelope = {
  /** Median(actualKwh / calibratedClearSkyKwh) across qualifying recent days - `null` when there isn't enough history to trust one. */
  factor: number | null;
  sampleDayCount: number;
  lookbackDays: number;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
}

/**
 * Recomputes the SAME hour-of-day calibration `calibration.ts` itself
 * would (identical params, identical deterministic algorithm) rather than
 * accepting one as a parameter — keeps this function's own signature
 * plain-object/primitive-only (consistent with `calibration.ts`'s and
 * `analog-days.ts`'s own `*Uncached` functions), which matters because the
 * cached wrapper (`cloudiness-envelope-cache.ts`) needs a `Map`-free
 * argument shape for `unstable_cache`'s own cache-key serialization.
 * Mutual consistency with the live forecast's own calibration factor is
 * guaranteed by both calls sharing the same deterministic inputs, not by
 * passing an object reference around.
 */
export async function computeHistoricalCloudinessFactorUncached(params: {
  plantId: string;
  organizationId: string;
  latitude: number;
  longitude: number;
  capacityKw: number;
  asOf: string;
}): Promise<HistoricalCloudinessEnvelope> {
  const { plantId, organizationId, latitude, longitude, capacityKw } = params;
  const asOf = new Date(params.asOf);
  const start = new Date(asOf.getTime() - LOOKBACK_DAYS * DAY_MS);

  const [availablePv, calibration] = await Promise.all([
    reconstructAvailablePv({ plantId, organizationId, start, end: asOf }),
    computeHourOfDayCalibrationUncached({ plantId, organizationId, latitude, longitude, capacityKw, asOf: params.asOf }),
  ]);

  const byDate = new Map<string, { actualKwh: number; calibratedClearSkyKwh: number; validCount: number }>();
  for (const interval of availablePv) {
    const dateKey = interval.intervalStart.toISOString().slice(0, 10);
    const entry = byDate.get(dateKey) ?? { actualKwh: 0, calibratedClearSkyKwh: 0, validCount: 0 };

    if (interval.availablePvKwh !== null) {
      entry.actualKwh += interval.availablePvKwh;
      entry.validCount += 1;
    }

    const { zenithDeg, elevationDeg } = solarPositionAt(interval.intervalStart, latitude, longitude);
    if (elevationDeg > 0) {
      const clearSkyGhi = haurwitzClearSkyGhi(zenithDeg);
      const clearSkyKw = estimatePhysicalPvKw({
        timestamp: interval.intervalStart,
        latitude,
        longitude,
        ghiWm2: clearSkyGhi,
        ambientTempC: FALLBACK_AMBIENT_TEMP_C,
        capacityKw,
      }).forecastKw;
      const calibratedClearSkyKw = applyHourOfDayCalibration(calibration, interval.intervalStart, clearSkyKw);
      entry.calibratedClearSkyKwh += calibratedClearSkyKw * (5 / 60);
    }

    byDate.set(dateKey, entry);
  }

  const ratios: number[] = [];
  for (const [, entry] of byDate) {
    if (entry.validCount < MIN_VALID_SAMPLES_PER_DAY || entry.calibratedClearSkyKwh <= 0) {
      continue;
    }
    ratios.push(entry.actualKwh / entry.calibratedClearSkyKwh);
  }

  if (ratios.length < MIN_DAYS_FOR_FACTOR) {
    return { factor: null, sampleDayCount: ratios.length, lookbackDays: LOOKBACK_DAYS };
  }

  const factor = Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, median(ratios)));
  return { factor, sampleDayCount: ratios.length, lookbackDays: LOOKBACK_DAYS };
}
