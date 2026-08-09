import { unstable_cache } from "next/cache";

import { reconstructAvailablePv } from "@/lib/digital-twin/available-pv-reconstruction";
import { estimatePhysicalPvKw } from "@/lib/forecast/physical-pv-model";
import { interpolateWeatherAt } from "@/lib/forecast/weather-interpolation";
import { getHistoricalSolarWeather } from "@/lib/weather/openMeteo";

/**
 * PV Generation Forecast — plant-specific historical calibration.
 *
 * Learns an hour-of-day multiplicative correction directly from this
 * plant's own real historical output (via `reconstructAvailablePv` —
 * NEVER raw curtailed export, so a historical Zero-Export period never
 * biases the forecast toward "less sun than there really was", satisfying
 * the Zero-Export-independence requirement structurally, not by a special
 * case here). This is what absorbs whatever the physical model's GHI-only
 * (no panel tilt/azimuth on file) simplification misses — a plant with a
 * morning-heavy or afternoon-heavy real orientation shows up here as an
 * hour-of-day factor above/below 1.0, learned empirically rather than
 * assumed.
 *
 * Deliberately just one factor per hour-of-day (not also per season) —
 * `LOOKBACK_DAYS` is short enough that a full seasonal model would be
 * fitting noise. This is a known, documented limitation (see the
 * forecast's final validation report), not an oversight.
 */

const LOOKBACK_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Below this physical-model estimate, ratios blow up for near-zero denominators — exclude near-dawn/dusk/night samples from the fit. */
const MIN_PHYSICAL_KW_FOR_RATIO = 2;
const MIN_SAMPLES_PER_HOUR = 8;
/** A single hour's real panel behavior should never be trusted below/above these bounds — protects against a short run of bad telemetry producing an extreme correction. */
const MIN_FACTOR = 0.5;
const MAX_FACTOR = 1.6;

export type HourOfDayCalibration = {
  /** UTC hour (0-23) -> multiplicative correction factor. Missing keys mean "not enough samples" — callers must default those to 1.0 (no correction), never fabricate a value. */
  factors: Map<number, number>;
  sampleCount: number;
  lookbackDays: number;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

export async function computeHourOfDayCalibrationUncached(params: {
  plantId: string;
  organizationId: string;
  latitude: number;
  longitude: number;
  capacityKw: number;
  asOf: string;
}): Promise<HourOfDayCalibration> {
  const { plantId, organizationId, latitude, longitude, capacityKw } = params;
  const asOf = new Date(params.asOf);
  const start = new Date(asOf.getTime() - LOOKBACK_DAYS * DAY_MS);

  const [availablePv, weatherPoints] = await Promise.all([
    reconstructAvailablePv({ plantId, organizationId, start, end: asOf }),
    getHistoricalSolarWeather(latitude, longitude, start, asOf).catch(() => []),
  ]);

  const ratiosByHour = new Map<number, number[]>();

  for (const interval of availablePv) {
    if (interval.availablePvKwh === null) {
      continue;
    }

    const weather = interpolateWeatherAt(weatherPoints, interval.intervalStart);
    if (!weather) {
      continue;
    }

    const physicalKw = estimatePhysicalPvKw({
      timestamp: interval.intervalStart,
      latitude,
      longitude,
      ghiWm2: weather.irradiance,
      ambientTempC: weather.temperature,
      capacityKw,
    }).forecastKw;

    if (physicalKw < MIN_PHYSICAL_KW_FOR_RATIO) {
      continue;
    }

    // Native interval is 5 minutes (`buildHistoricalIntervals`) — energy /
    // (5/60)h converts back to average kW for a fair ratio against the
    // physical model's own instantaneous kW estimate.
    const actualKw = interval.availablePvKwh / (5 / 60);
    const ratio = actualKw / physicalKw;

    const hour = interval.intervalStart.getUTCHours();
    const existing = ratiosByHour.get(hour) ?? [];
    existing.push(ratio);
    ratiosByHour.set(hour, existing);
  }

  const factors = new Map<number, number>();
  let sampleCount = 0;

  for (const [hour, ratios] of ratiosByHour) {
    sampleCount += ratios.length;
    if (ratios.length < MIN_SAMPLES_PER_HOUR) {
      continue;
    }
    const factor = Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, median(ratios)));
    factors.set(hour, factor);
  }

  return { factors, sampleCount, lookbackDays: LOOKBACK_DAYS };
}

/**
 * Cached for 6 hours per plant+day — this recomputes a 60-day historical
 * reconstruction plus an archive-weather fetch, real cost that must not run
 * on every Dashboard render (same pattern `lib/admin/platform-health.ts`'s
 * `getDataIntegrityReport` already established for a comparably expensive
 * scan). `asOf` is passed in as a `YYYY-MM-DD` cache-key component (backtest
 * callers pass distinct historical dates so each walk-forward day gets its
 * own correctly-scoped, non-leaking cache entry instead of colliding on
 * "today").
 */
export const getHourOfDayCalibration = unstable_cache(
  computeHourOfDayCalibrationUncached,
  ["pv-forecast-hour-of-day-calibration"],
  { revalidate: 21_600 },
);

export function applyHourOfDayCalibration(calibration: HourOfDayCalibration, timestamp: Date, physicalWeatherKw: number): number {
  const factor = calibration.factors.get(timestamp.getUTCHours()) ?? 1;
  return physicalWeatherKw * factor;
}
