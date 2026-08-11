import { reconstructAvailablePv } from "@/lib/digital-twin/available-pv-reconstruction";
import { averageAnalogShape, type AnalogDayRejection } from "@/lib/forecast/analog-days";
import { getAnalogDays } from "@/lib/forecast/analog-days-cache";
import { getHourOfDayCalibration } from "@/lib/forecast/calibration-cache";
import { getHistoricalCloudinessFactor } from "@/lib/forecast/cloudiness-envelope-cache";
import {
  analogWeightForTier,
  classifyConfidence,
  classifyHorizonTier,
  meanClearSkyGhiForDay,
  type ForecastConfidence,
  type ForecastHorizonTier,
} from "@/lib/forecast/forecast-tiers";
import {
  DEFAULT_ANALOG_WEIGHT,
  DEFAULT_HORIZON_HOURS,
  dayKeyUtc,
  dayStartUtc,
  generatePvForecastCore,
} from "@/lib/forecast/pv-forecast-core";
import { FORECAST_INTERVAL_MINUTES, FORECAST_MODEL_VERSION, type PvForecastResult, type WeatherInputSource } from "@/lib/forecast/types";
import { getSolarWeather } from "@/lib/weather/openMeteo";

export { DEFAULT_ANALOG_WEIGHT, DEFAULT_HORIZON_HOURS, generatePvForecastCore };
export type { ForecastCoreParams } from "@/lib/forecast/pv-forecast-core";

/**
 * PV Generation Forecast — ensemble orchestrator.
 *
 * Combines every layer (physical solar baseline + weather, plant-specific
 * historical calibration, analog days, recent glide-path correction) into
 * one 15-minute-resolution forecast. This is the single entry point every
 * caller (the Dashboard's `GlidepathCard`, the backtest harness) uses —
 * neither reimplements any of the blending logic itself.
 *
 * `generatePvForecastCore` (`pv-forecast-core.ts`) is a pure function of
 * its inputs (no I/O) so it is directly deterministic/testable;
 * `generatePvForecast` below is the live wrapper that fetches those inputs
 * from Open-Meteo and this plant's own historical data.
 */

const ANALOG_DAY_COUNT = 3;

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

/** Median, not mean — a single anomalous analog day (unusually strong or unusually weak) should not unilaterally drag the MEDIUM/LONG magnitude anchor (see `pv-forecast-core.ts`'s use of `analogMagnitudeKwh`) the way an average of up to 3 samples otherwise would. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
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

  const [weather, observedElapsedToday, calibration, historicalCloudiness] = await Promise.all([
    getSolarWeather(latitude, longitude).catch(() => null),
    reconstructAvailablePv({ plantId, organizationId, start: todayStart, end: now }).catch(() => []),
    getHourOfDayCalibration({ plantId, organizationId, latitude, longitude, capacityKw, asOf: now.toISOString() }).catch(
      () => ({ factors: new Map<number, number>(), sampleCount: 0, lookbackDays: 0 }),
    ),
    getHistoricalCloudinessFactor({ plantId, organizationId, latitude, longitude, capacityKw, asOf: now.toISOString() }).catch(
      () => ({ factor: null, sampleDayCount: 0, lookbackDays: 0 }),
    ),
  ]);
  const historicalCloudinessFactor = historicalCloudiness.factor;

  const weatherPoints = weather?.hourly ?? [];

  const dayStarts: Date[] = [];
  for (let t = dayStartUtc(now).getTime(); t < horizonEnd.getTime(); t += 24 * 60 * 60 * 1000) {
    dayStarts.push(new Date(t));
  }

  const analogShapeByDayUtc = new Map<string, { shape: number[] | null; dates: string[]; analogMagnitudeKwh: number | null }>();
  const tierByDayKey = new Map<string, ForecastHorizonTier>();
  const confidenceByDayKey = new Map<string, ForecastConfidence>();
  const weatherSourceByDayKey = new Map<string, WeatherInputSource>();
  const analogRejections: AnalogDayRejection[] = [];

  await Promise.all(
    dayStarts.map(async (dayStart) => {
      const dayKey = dayKeyUtc(dayStart);
      const leadTimeHours = Math.max(0, (dayStart.getTime() - now.getTime()) / (60 * 60 * 1000));
      const nominalTier = classifyHorizonTier(leadTimeHours);

      const dayPoints = weatherPoints.filter((point) => dayKeyUtc(point.time) === dayKey);
      const hasRealWeather = dayPoints.length > 0;
      // Weather-horizon honesty fix (Aug 2026 Chomakovtsi investigation): a
      // day can be nominally SHORT by lead time alone while Open-Meteo's
      // actual `forecast_days` coverage doesn't reach it (confirmed: a
      // mid-day-issued forecast for +41h out had zero real weather points).
      // A tier must never claim a stronger weather horizon than the data
      // backing it actually supports - MEDIUM/LONG already assume no real
      // weather by design, so only a falsely-SHORT day is downgraded.
      const tier: ForecastHorizonTier = hasRealWeather ? nominalTier : nominalTier === "SHORT" ? "MEDIUM" : nominalTier;
      tierByDayKey.set(dayKey, tier);
      weatherSourceByDayKey.set(dayKey, hasRealWeather ? "REAL_FORECAST" : "CLEAR_SKY_FALLBACK");

      const targetMeanGhi = hasRealWeather
        ? dayPoints.reduce((sum, p) => sum + p.irradiance, 0) / dayPoints.length
        : meanClearSkyGhiForDay(dayStart, latitude, longitude);
      const targetMeanCloudCover = hasRealWeather ? dayPoints.reduce((sum, p) => sum + p.cloudCover, 0) / dayPoints.length : 50;
      const cloudVolatility = hasRealWeather ? stddev(dayPoints.map((p) => p.cloudCover)) : null;

      const { candidates: analogDays, rejected } = await getAnalogDays({
        plantId,
        organizationId,
        latitude,
        longitude,
        targetDateUtc: dayKey,
        targetMeanGhi,
        targetMeanCloudCover,
        count: ANALOG_DAY_COUNT,
      }).catch(() => ({ candidates: [], rejected: [] }));

      const analogMagnitudeKwh = analogDays.length > 0 ? median(analogDays.map((d) => d.totalEnergyKwh)) : null;
      analogShapeByDayUtc.set(dayKey, {
        shape: averageAnalogShape(analogDays),
        dates: analogDays.map((d) => d.dateUtc),
        analogMagnitudeKwh,
      });
      confidenceByDayKey.set(dayKey, classifyConfidence({ tier, cloudVolatility, analogDayCount: analogDays.length }));
      analogRejections.push(...rejected);
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
      weatherSource: weatherSourceByDayKey.get(dayKey) ?? "REAL_FORECAST",
      historicalCloudinessFactor,
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
      analogCandidatesRejected: dedupeRejections(analogRejections),
    },
  };
}

/** De-duplicates rejection reasons across the day-loop above — every day in the horizon shares the same 60-day candidate pool, so the same rejected date+reason pair would otherwise repeat once per forecast day. */
function dedupeRejections(rejections: AnalogDayRejection[]): AnalogDayRejection[] {
  const seen = new Set<string>();
  const result: AnalogDayRejection[] = [];
  for (const r of rejections) {
    const key = `${r.dateUtc}|${r.reason}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(r);
    }
  }
  return result.sort((a, b) => a.dateUtc.localeCompare(b.dateUtc));
}

/** Long enough to cover "the rest of the current calendar month" starting from any day of any month (max 31 days), plus the rolling 7-day weekly stat, with a small buffer. */
export const DEFAULT_EXTENDED_HORIZON_DAYS = 35;
