import { unstable_cache } from "next/cache";

import { reconstructAvailablePv } from "@/lib/digital-twin/available-pv-reconstruction";
import { averageAnalogShape, analogBucketIndex, getAnalogDays } from "@/lib/forecast/analog-days";
import { applyHourOfDayCalibration, getHourOfDayCalibration, type HourOfDayCalibration } from "@/lib/forecast/calibration";
import {
  analogWeightForTier,
  classifyConfidence,
  classifyHorizonTier,
  meanClearSkyGhiForDay,
  type ForecastConfidence,
  type ForecastHorizonTier,
} from "@/lib/forecast/forecast-tiers";
import { applyGlidePath, computeRecentBias } from "@/lib/forecast/glide-path";
import { estimatePhysicalPvKw } from "@/lib/forecast/physical-pv-model";
import { FORECAST_INTERVAL_MINUTES, FORECAST_MODEL_VERSION, type PvForecastInterval, type PvForecastResult } from "@/lib/forecast/types";
import { interpolateWeatherAt } from "@/lib/forecast/weather-interpolation";
import { haurwitzClearSkyGhi } from "@/lib/forecast/clear-sky";
import { solarPositionAt } from "@/lib/forecast/solar-position";
import { getSolarWeather, type SolarWeatherPoint } from "@/lib/weather/openMeteo";

/**
 * PV Generation Forecast — ensemble orchestrator.
 *
 * Combines every layer (physical solar baseline + weather, plant-specific
 * historical calibration, analog days, recent glide-path correction) into
 * one 15-minute-resolution forecast. This is the single entry point every
 * caller (the Dashboard's `GlidepathCard`, the backtest harness) uses —
 * neither reimplements any of the blending logic itself.
 *
 * `generatePvForecastCore` is a pure function of its inputs (no I/O) so it
 * is directly deterministic/testable; `generatePvForecast` is the live
 * wrapper that fetches those inputs from Open-Meteo and this plant's own
 * historical data.
 */

export const DEFAULT_HORIZON_HOURS = 24;
/**
 * Selected via walk-forward backtesting against real Atlanta historical
 * data (10 test days spanning clear/cloudy/variable/Zero-Export/
 * non-Zero-Export conditions): candidates {0, 0.15, 0.2, 0.3, 0.5} were
 * each run through the full day-ahead backtest, and 0.5 produced the
 * lowest mean daily energy error (17.575% vs 17.585% at weight 0) — not an
 * arbitrary choice, though the effect size itself is small, a direct
 * consequence of this plant's short (~40-day) telemetry history limiting
 * how many genuinely similar analog days exist to blend in.
 */
export const DEFAULT_ANALOG_WEIGHT = 0.5;
const ANALOG_DAY_COUNT = 3;
const GLIDE_PATH_DECAY_HOURS = 3;
const RECENT_BIAS_WINDOW_HOURS = 2;
/** Neutral fallback ambient temperature (°C) used only when weather is entirely unavailable — see `weatherFallbackUsed`. */
const FALLBACK_AMBIENT_TEMP_C = 20;

function ceilTo15Min(date: Date): Date {
  const ms = FORECAST_INTERVAL_MINUTES * 60 * 1000;
  return new Date(Math.ceil(date.getTime() / ms) * ms);
}

function dayStartUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dayKeyUtc(date: Date): string {
  return dayStartUtc(date).toISOString().slice(0, 10);
}

/**
 * Aggregates today's native 5-minute reconstructed Available PV
 * (`observedElapsedToday`, `available-pv-reconstruction.ts`) into the same
 * 15-minute grid `intervals` uses — so a UI can plot "actual so far" and
 * "forecast for the rest" as one continuous series without reimplementing
 * this bucketing itself.
 */
/** Native telemetry samples per 15-minute bucket (5-minute grid, `historical-intervals.ts`) — a bucket only counts as "actual" once all three have arrived, never a partial/in-progress average presented as if it were a full 15 minutes. */
const NATIVE_SAMPLES_PER_BUCKET = 3;

function bucketObservedToday(
  observedElapsedToday: Array<{ intervalStart: Date; availablePvKwh: number | null }>,
): { timestamp: Date; actualKwh: number; actualKw: number }[] {
  const bucketMs = FORECAST_INTERVAL_MINUTES * 60 * 1000;
  const buckets = new Map<number, { sum: number; count: number; nullSeen: boolean }>();

  for (const point of observedElapsedToday) {
    const bucketStart = Math.floor(point.intervalStart.getTime() / bucketMs) * bucketMs;
    const entry = buckets.get(bucketStart) ?? { sum: 0, count: 0, nullSeen: false };
    if (point.availablePvKwh === null) {
      entry.nullSeen = true;
    } else {
      entry.sum += point.availablePvKwh;
      entry.count += 1;
    }
    buckets.set(bucketStart, entry);
  }

  return Array.from(buckets.entries())
    .filter(([, entry]) => !entry.nullSeen && entry.count === NATIVE_SAMPLES_PER_BUCKET)
    .sort(([a], [b]) => a - b)
    .map(([bucketStart, { sum }]) => ({
      timestamp: new Date(bucketStart),
      actualKwh: sum,
      actualKw: sum / (FORECAST_INTERVAL_MINUTES / 60),
    }));
}

/**
 * GHI/temperature at `timestamp` — real weather when available, otherwise a
 * clear-sky assumption (the physically neutral default: "assume the best
 * case, unmodified by clouds") so a weather-provider outage degrades the
 * forecast gracefully instead of producing no forecast at all, matching
 * this codebase's existing "external outage must never break the page"
 * convention (`fetchSolarWeatherSafe`).
 */
function weatherOrClearSkyFallback(
  weatherPoints: SolarWeatherPoint[],
  timestamp: Date,
  latitude: number,
  longitude: number,
): { irradiance: number; temperature: number; usedFallback: boolean } {
  const interpolated = interpolateWeatherAt(weatherPoints, timestamp);
  if (interpolated) {
    return { ...interpolated, usedFallback: false };
  }

  const { zenithDeg } = solarPositionAt(timestamp, latitude, longitude);
  return { irradiance: haurwitzClearSkyGhi(zenithDeg), temperature: FALLBACK_AMBIENT_TEMP_C, usedFallback: true };
}

export type ForecastCoreParams = {
  plantId: string;
  latitude: number;
  longitude: number;
  capacityKw: number;
  now: Date;
  horizonEnd: Date;
  weatherPoints: SolarWeatherPoint[];
  calibration: HourOfDayCalibration;
  analogShapeByDayUtc: Map<string, { shape: number[] | null; dates: string[] }>;
  analogWeight: number;
  observedElapsedToday: Array<{ intervalStart: Date; availablePvKwh: number | null }>;
  decayHours?: number;
  /** Which forecast-hierarchy tier this whole call represents (see `lib/forecast/forecast-tiers.ts`) — stamped onto every produced interval. Defaults preserve this function's original single-tier behavior for any caller that doesn't pass one (e.g. the backtest harness). */
  horizonTier?: ForecastHorizonTier;
  confidence?: ForecastConfidence;
};

export function generatePvForecastCore(params: ForecastCoreParams): PvForecastResult {
  const {
    plantId,
    latitude,
    longitude,
    capacityKw,
    now,
    horizonEnd,
    weatherPoints,
    calibration,
    analogShapeByDayUtc,
    analogWeight,
    observedElapsedToday,
    decayHours = GLIDE_PATH_DECAY_HOURS,
    horizonTier = "SHORT",
    confidence = "MEDIUM",
  } = params;

  let weatherFallbackUsed = false;

  // Recent bias: compare the last `RECENT_BIAS_WINDOW_HOURS` of real,
  // reconstructed Available PV against what the physical+weather+
  // calibration model would have said for those same instants.
  const recentBiasWindowStart = new Date(now.getTime() - RECENT_BIAS_WINDOW_HOURS * 60 * 60 * 1000);
  const observedVsModel = observedElapsedToday
    .filter((point) => point.intervalStart.getTime() >= recentBiasWindowStart.getTime() && point.intervalStart.getTime() < now.getTime())
    .map((point) => {
      const weather = weatherOrClearSkyFallback(weatherPoints, point.intervalStart, latitude, longitude);
      weatherFallbackUsed = weatherFallbackUsed || weather.usedFallback;
      const physicalKw = estimatePhysicalPvKw({
        timestamp: point.intervalStart,
        latitude,
        longitude,
        ghiWm2: weather.irradiance,
        ambientTempC: weather.temperature,
        capacityKw,
      }).forecastKw;
      const calibratedKw = applyHourOfDayCalibration(calibration, point.intervalStart, physicalKw);
      return { actualKw: point.availablePvKwh !== null ? point.availablePvKwh / (5 / 60) : 0, modelKw: calibratedKw };
    })
    .filter((point) => point.modelKw > 0);

  const recentBias = computeRecentBias(observedVsModel);

  const forecastStart = ceilTo15Min(now);
  const intervalMs = FORECAST_INTERVAL_MINUTES * 60 * 1000;
  const timestamps: Date[] = [];
  for (let t = forecastStart.getTime(); t < horizonEnd.getTime(); t += intervalMs) {
    timestamps.push(new Date(t));
  }

  // Pass 1: physical + weather + calibration, per timestamp; also
  // accumulate each calendar day's calibrated energy total (needed to
  // rescale the analog component's normalized shape into real kW).
  const perTimestamp = timestamps.map((timestamp) => {
    const weather = weatherOrClearSkyFallback(weatherPoints, timestamp, latitude, longitude);
    weatherFallbackUsed = weatherFallbackUsed || weather.usedFallback;
    const physical = estimatePhysicalPvKw({
      timestamp,
      latitude,
      longitude,
      ghiWm2: weather.irradiance,
      ambientTempC: weather.temperature,
      capacityKw,
    });
    const calibratedKw = applyHourOfDayCalibration(calibration, timestamp, physical.forecastKw);
    return { timestamp, physicalWeatherKw: physical.forecastKw, calibratedKw, isDaylight: physical.forecastKw > 0 || physical.elevationDeg > 0 };
  });

  const dailyCalibratedTotalKwh = new Map<string, number>();
  for (const point of perTimestamp) {
    const key = dayKeyUtc(point.timestamp);
    dailyCalibratedTotalKwh.set(key, (dailyCalibratedTotalKwh.get(key) ?? 0) + point.calibratedKw * (FORECAST_INTERVAL_MINUTES / 60));
  }

  const analogDatesUsed = new Set<string>();

  const intervals: PvForecastInterval[] = perTimestamp.map(({ timestamp, physicalWeatherKw, calibratedKw, isDaylight }) => {
    // Night is structural, not statistical: no analog/glide-path/
    // calibration noise can ever push a night interval above zero.
    if (!isDaylight) {
      return {
        timestamp,
        forecastKwh: 0,
        forecastKw: 0,
        capacityClipped: false,
        horizonTier,
        confidence,
        components: { physicalWeatherKw: 0, calibrationFactor: 1, analogKw: null, analogWeight, glidePathFactor: 1 },
      };
    }

    const dayKey = dayKeyUtc(timestamp);
    const analogEntry = analogShapeByDayUtc.get(dayKey);
    const dailyTotalKwh = dailyCalibratedTotalKwh.get(dayKey) ?? 0;

    let analogKw: number | null = null;
    if (analogEntry?.shape && dailyTotalKwh > 0) {
      const bucket = analogBucketIndex(timestamp);
      const shapeFraction = analogEntry.shape[bucket] ?? 0;
      analogKw = (shapeFraction * dailyTotalKwh) / (FORECAST_INTERVAL_MINUTES / 60);
      for (const date of analogEntry.dates) {
        analogDatesUsed.add(date);
      }
    }

    const combinedKw = analogKw !== null ? calibratedKw * (1 - analogWeight) + analogKw * analogWeight : calibratedKw;
    const glideKw = applyGlidePath(combinedKw, timestamp, now, recentBias, decayHours);

    const capacityClipped = glideKw > capacityKw;
    const forecastKw = Math.min(capacityKw, Math.max(0, glideKw));
    const glidePathFactor = combinedKw > 0 ? glideKw / combinedKw : 1;
    const calibrationFactor = physicalWeatherKw > 0 ? calibratedKw / physicalWeatherKw : 1;

    return {
      timestamp,
      forecastKwh: forecastKw * (FORECAST_INTERVAL_MINUTES / 60),
      forecastKw,
      capacityClipped,
      horizonTier,
      confidence,
      components: { physicalWeatherKw, calibrationFactor, analogKw, analogWeight, glidePathFactor },
    };
  });

  return {
    modelVersion: FORECAST_MODEL_VERSION,
    weatherSource: "open-meteo",
    generatedAt: now,
    plantId,
    intervalMinutes: FORECAST_INTERVAL_MINUTES,
    intervals,
    observedToday: bucketObservedToday(observedElapsedToday),
    diagnostics: {
      calibrationSampleCount: calibration.sampleCount,
      calibrationLookbackDays: calibration.lookbackDays,
      analogDayDates: Array.from(analogDatesUsed).sort(),
      analogWeight,
      recentBias,
      weatherFallbackUsed,
    },
  };
}

export type GeneratePvForecastParams = {
  plantId: string;
  organizationId: string;
  latitude: number;
  longitude: number;
  capacityKw: number;
  now?: Date;
  horizonHours?: number;
  analogWeight?: number;
};

function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
}

/**
 * Live entry point: fetches real Open-Meteo weather, this plant's own
 * historical calibration/analog data, and today's elapsed reconstructed
 * Available PV, then runs the forecast hierarchy (`lib/forecast/
 * forecast-tiers.ts`) one calendar day at a time — each day is classified
 * into SHORT/MEDIUM/LONG by its lead time from `now`, gets its own
 * analog-weight and (for days beyond real weather coverage) a
 * climatological GHI estimate instead of a fabricated "0" — then delegates
 * to the exact same, unmodified `generatePvForecastCore` per day. Every
 * fetch is individually degraded (never thrown to the caller) so a weather
 * or historical-data outage narrows the forecast's inputs rather than
 * breaking the Dashboard — same convention `fetchSolarWeatherSafe` already
 * established for this exact card's row.
 */
export async function generatePvForecast(params: GeneratePvForecastParams): Promise<PvForecastResult> {
  const {
    plantId,
    organizationId,
    latitude,
    longitude,
    capacityKw,
    now = new Date(),
    horizonHours = DEFAULT_HORIZON_HOURS,
    analogWeight: analogWeightOverride,
  } = params;

  const horizonEnd = new Date(now.getTime() + horizonHours * 60 * 60 * 1000);
  const todayStart = dayStartUtc(now);

  const [weather, observedElapsedToday, calibration] = await Promise.all([
    getSolarWeather(latitude, longitude).catch(() => null),
    reconstructAvailablePv({ plantId, organizationId, start: todayStart, end: now }).catch(() => []),
    getHourOfDayCalibration({ plantId, organizationId, latitude, longitude, capacityKw, asOf: now.toISOString() }).catch(
      () => ({ factors: new Map<number, number>(), sampleCount: 0, lookbackDays: 0 }),
    ),
  ]);

  const weatherPoints = weather?.hourly ?? [];

  const dayStarts: Date[] = [];
  for (let t = dayStartUtc(now).getTime(); t < horizonEnd.getTime(); t += 24 * 60 * 60 * 1000) {
    dayStarts.push(new Date(t));
  }

  const analogShapeByDayUtc = new Map<string, { shape: number[] | null; dates: string[] }>();
  const tierByDayKey = new Map<string, ForecastHorizonTier>();
  const confidenceByDayKey = new Map<string, ForecastConfidence>();

  await Promise.all(
    dayStarts.map(async (dayStart) => {
      const dayKey = dayKeyUtc(dayStart);
      const leadTimeHours = Math.max(0, (dayStart.getTime() - now.getTime()) / (60 * 60 * 1000));
      const tier = classifyHorizonTier(leadTimeHours);
      tierByDayKey.set(dayKey, tier);

      const dayPoints = weatherPoints.filter((point) => dayKeyUtc(point.time) === dayKey);
      const hasRealWeather = dayPoints.length > 0;
      const targetMeanGhi = hasRealWeather
        ? dayPoints.reduce((sum, p) => sum + p.irradiance, 0) / dayPoints.length
        : meanClearSkyGhiForDay(dayStart, latitude, longitude);
      const targetMeanCloudCover = hasRealWeather ? dayPoints.reduce((sum, p) => sum + p.cloudCover, 0) / dayPoints.length : 50;
      const cloudVolatility = hasRealWeather ? stddev(dayPoints.map((p) => p.cloudCover)) : null;

      const analogDays = await getAnalogDays({
        plantId,
        organizationId,
        latitude,
        longitude,
        targetDateUtc: dayKey,
        targetMeanGhi,
        targetMeanCloudCover,
        count: ANALOG_DAY_COUNT,
      }).catch(() => []);

      analogShapeByDayUtc.set(dayKey, { shape: averageAnalogShape(analogDays), dates: analogDays.map((d) => d.dateUtc) });
      confidenceByDayKey.set(dayKey, classifyConfidence({ tier, cloudVolatility, analogDayCount: analogDays.length }));
    }),
  );

  // One `generatePvForecastCore` call per calendar day (never a second
  // forecasting algorithm) - each day gets its own tier-appropriate
  // analog weight; only the first (today) carries real elapsed-today data,
  // since glide-path/recent-bias correction has no meaning for a future day.
  const dayResults = dayStarts.map((dayStart, index) => {
    const dayKey = dayKeyUtc(dayStart);
    const dayEnd = new Date(Math.min(dayStart.getTime() + 24 * 60 * 60 * 1000, horizonEnd.getTime()));
    const tier = tierByDayKey.get(dayKey) ?? "LONG";
    const confidence = confidenceByDayKey.get(dayKey) ?? "LOW";
    const isFirstDay = index === 0;

    return generatePvForecastCore({
      plantId,
      latitude,
      longitude,
      capacityKw,
      now: isFirstDay ? now : dayStart,
      horizonEnd: dayEnd,
      weatherPoints,
      calibration,
      analogShapeByDayUtc,
      analogWeight: analogWeightOverride ?? analogWeightForTier(tier),
      observedElapsedToday: isFirstDay ? observedElapsedToday : [],
      horizonTier: tier,
      confidence,
    });
  });

  const analogDayDates = new Set<string>();
  for (const result of dayResults) {
    for (const date of result.diagnostics.analogDayDates) {
      analogDayDates.add(date);
    }
  }

  const firstResult = dayResults[0];

  return {
    modelVersion: FORECAST_MODEL_VERSION,
    weatherSource: "open-meteo",
    generatedAt: now,
    plantId,
    intervalMinutes: FORECAST_INTERVAL_MINUTES,
    intervals: dayResults.flatMap((result) => result.intervals),
    observedToday: firstResult?.observedToday ?? [],
    diagnostics: {
      calibrationSampleCount: calibration.sampleCount,
      calibrationLookbackDays: calibration.lookbackDays,
      analogDayDates: Array.from(analogDayDates).sort(),
      analogWeight: firstResult?.diagnostics.analogWeight ?? DEFAULT_ANALOG_WEIGHT,
      recentBias: firstResult?.diagnostics.recentBias ?? 1,
      weatherFallbackUsed: dayResults.some((result) => result.diagnostics.weatherFallbackUsed),
    },
  };
}

/** Long enough to cover "the rest of the current calendar month" starting from any day of any month (max 31 days), plus the rolling 7-day weekly stat, with a small buffer. */
export const DEFAULT_EXTENDED_HORIZON_DAYS = 35;

/** Rounds down to the current hour (UTC) — the cache-key granularity for `getExtendedPvForecast` below, so every request within the same hour reuses one computation instead of each one re-running the full multi-day forecast. */
function roundDownToHour(date: Date): Date {
  const ms = 60 * 60 * 1000;
  return new Date(Math.floor(date.getTime() / ms) * ms);
}

async function computeExtendedPvForecastUncached(params: {
  plantId: string;
  organizationId: string;
  latitude: number;
  longitude: number;
  capacityKw: number;
  nowHourIso: string;
  horizonDays: number;
}): Promise<PvForecastResult> {
  return generatePvForecast({
    plantId: params.plantId,
    organizationId: params.organizationId,
    latitude: params.latitude,
    longitude: params.longitude,
    capacityKw: params.capacityKw,
    now: new Date(params.nowHourIso),
    horizonHours: params.horizonDays * 24,
  });
}

const getExtendedPvForecastCached = unstable_cache(computeExtendedPvForecastUncached, ["pv-forecast-extended"], {
  revalidate: 3600,
});

/**
 * `unstable_cache`'s underlying cache handler round-trips its return value
 * through JSON on a cache HIT (the value that comes back from Next's cache
 * store, as opposed to a live/cold call, which returns the exact in-memory
 * object `computeExtendedPvForecastUncached` constructed) — which silently
 * turns every `Date` field into a plain ISO string, since `JSON.stringify`
 * has no `Date` representation and `JSON.parse` never reconstructs one.
 * `PvForecastResult`'s type still declares these as `Date` (correct for a
 * cache MISS), so any caller trusting that type and calling
 * `.timestamp.getTime()` crashes the instant a cache HIT hands back a
 * string instead — this is exactly the production incident this function
 * exists to prevent. Every `Date`-typed field is re-hydrated here,
 * unconditionally, so every caller gets a real `Date` instance regardless
 * of whether the value came from cache.
 */
function reviveDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function reviveForecastResult(result: PvForecastResult): PvForecastResult {
  return {
    ...result,
    generatedAt: reviveDate(result.generatedAt),
    intervals: result.intervals.map((interval) => ({ ...interval, timestamp: reviveDate(interval.timestamp) })),
    observedToday: result.observedToday.map((point) => ({ ...point, timestamp: reviveDate(point.timestamp) })),
  };
}

/**
 * Cached, multi-week/month-horizon forecast (Live Energy Forecast
 * Integration milestone) — used only for the Weekly/Monthly forecast
 * summary stats and the Week/Month chart's future-portion overlay, never
 * for Today's near-term chart (that stays on the always-fresh, uncached
 * `generatePvForecast` above, since "remaining today" genuinely needs
 * precise, current "now"). Cached for 1 hour per plant (`nowHourIso`
 * rounds down to the current hour so repeated calls within that hour hit
 * the same key) — a multi-week forecast has no reason to be recomputed on
 * every Dashboard render, per this milestone's explicit performance
 * requirement.
 */
export async function getExtendedPvForecast(params: {
  plantId: string;
  organizationId: string;
  latitude: number;
  longitude: number;
  capacityKw: number;
  nowHourIso: string;
  horizonDays: number;
}): Promise<PvForecastResult> {
  const result = await getExtendedPvForecastCached(params);
  return reviveForecastResult(result);
}

export { roundDownToHour };
