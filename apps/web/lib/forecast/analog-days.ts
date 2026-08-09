import { unstable_cache } from "next/cache";

import { reconstructAvailablePv } from "@/lib/digital-twin/available-pv-reconstruction";
import { sunriseSunsetUtc } from "@/lib/forecast/solar-position";
import { getHistoricalSolarWeather } from "@/lib/weather/openMeteo";

/**
 * PV Generation Forecast — analog-day (similarity-based ensemble) layer.
 *
 * Selects the historical days most similar to the target forecast day —
 * NOT blindly "the previous 3 calendar days" — by combining season
 * (day-of-year proximity), daylight geometry (sunrise-to-sunset length,
 * purely astronomic, needs no data), and forecasted weather similarity
 * (mean GHI/cloud cover). Each candidate's own intraday production shape
 * comes from `reconstructAvailablePv` (never raw curtailed export), so a
 * historical Zero-Export day contributes its reconstructed, physically
 * available shape — never a curtailed one.
 */

const LOOKBACK_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const BUCKET_MINUTES = 15;
const BUCKETS_PER_DAY = (24 * 60) / BUCKET_MINUTES;
/** A candidate day needs at least this fraction of its 15-minute buckets with a real (non-null) reconstructed value to be usable at all. */
const MIN_VALID_BUCKET_FRACTION = 0.8;

export type AnalogDay = {
  dateUtc: string;
  similarityScore: number;
  /** 96 fractions (15-minute buckets, midnight-aligned UTC), summing to 1 over the daylight buckets — the day's normalized intraday production shape. */
  normalizedShape: number[];
};

function dayStartUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function bucketIndex(date: Date): number {
  return Math.floor((date.getUTCHours() * 60 + date.getUTCMinutes()) / BUCKET_MINUTES);
}

function daylightHours(date: Date, latitude: number, longitude: number): number {
  const window = sunriseSunsetUtc(date, latitude, longitude);
  if (!window) {
    return 0;
  }
  return (window.sunset.getTime() - window.sunrise.getTime()) / (60 * 60 * 1000);
}

export async function computeAnalogDaysUncached(params: {
  plantId: string;
  organizationId: string;
  latitude: number;
  longitude: number;
  targetDateUtc: string;
  targetMeanGhi: number;
  targetMeanCloudCover: number;
  count: number;
}): Promise<AnalogDay[]> {
  const { plantId, organizationId, latitude, longitude, count } = params;
  const targetDate = dayStartUtc(new Date(params.targetDateUtc));
  const historyStart = new Date(targetDate.getTime() - LOOKBACK_DAYS * DAY_MS);
  // Exclusive of the target day itself — analog candidates are always
  // strictly in the past relative to what's being forecast.
  const historyEnd = new Date(Math.min(targetDate.getTime(), Date.now()));

  if (historyEnd.getTime() <= historyStart.getTime()) {
    return [];
  }

  const [availablePv, weatherPoints] = await Promise.all([
    reconstructAvailablePv({ plantId, organizationId, start: historyStart, end: historyEnd }),
    getHistoricalSolarWeather(latitude, longitude, historyStart, historyEnd).catch(() => []),
  ]);

  const byDay = new Map<number, { energyByBucket: number[]; validBuckets: number }>();

  for (const interval of availablePv) {
    const dayKey = dayStartUtc(interval.intervalStart).getTime();
    let entry = byDay.get(dayKey);
    if (!entry) {
      entry = { energyByBucket: new Array<number>(BUCKETS_PER_DAY).fill(0), validBuckets: 0 };
      byDay.set(dayKey, entry);
    }
    if (interval.availablePvKwh !== null) {
      entry.energyByBucket[bucketIndex(interval.intervalStart)]! += interval.availablePvKwh;
      entry.validBuckets += 1;
    }
  }

  const weatherByDay = new Map<number, { sumGhi: number; sumCloud: number; count: number }>();
  for (const point of weatherPoints) {
    const dayKey = dayStartUtc(point.time).getTime();
    const entry = weatherByDay.get(dayKey) ?? { sumGhi: 0, sumCloud: 0, count: 0 };
    entry.sumGhi += point.irradiance;
    entry.sumCloud += point.cloudCover;
    entry.count += 1;
    weatherByDay.set(dayKey, entry);
  }

  // 5-minute native resolution -> 3 samples expected per 15-minute bucket
  // during a full day (288 samples/day / 96 buckets), used only to judge
  // "enough real data", not for the energy sum itself.
  const expectedSamplesPerBucket = 3;
  const targetDaylightHours = daylightHours(targetDate, latitude, longitude);

  const candidates: AnalogDay[] = [];

  for (const [dayKey, entry] of byDay) {
    const candidateDate = new Date(dayKey);
    const validFraction = entry.validBuckets / (BUCKETS_PER_DAY * expectedSamplesPerBucket);
    if (validFraction < MIN_VALID_BUCKET_FRACTION) {
      continue;
    }

    const totalEnergy = entry.energyByBucket.reduce((sum, value) => sum + value, 0);
    if (totalEnergy <= 0) {
      continue;
    }

    const weather = weatherByDay.get(dayKey);
    const candidateMeanGhi = weather && weather.count > 0 ? weather.sumGhi / weather.count : null;
    const candidateMeanCloud = weather && weather.count > 0 ? weather.sumCloud / weather.count : null;

    const dayOfYearTarget = Math.floor((targetDate.getTime() - Date.UTC(targetDate.getUTCFullYear(), 0, 1)) / DAY_MS);
    const dayOfYearCandidate = Math.floor((candidateDate.getTime() - Date.UTC(candidateDate.getUTCFullYear(), 0, 1)) / DAY_MS);
    const rawSeasonDiff = Math.abs(dayOfYearTarget - dayOfYearCandidate);
    const seasonDist = Math.min(rawSeasonDiff, 365 - rawSeasonDiff) / 182.5;

    const candidateDaylightHours = daylightHours(candidateDate, latitude, longitude);
    const daylightDist = Math.min(1, Math.abs(targetDaylightHours - candidateDaylightHours) / 6);

    const weatherDist = candidateMeanGhi !== null ? Math.min(1, Math.abs(params.targetMeanGhi - candidateMeanGhi) / 500) : 1;
    const cloudDist = candidateMeanCloud !== null ? Math.min(1, Math.abs(params.targetMeanCloudCover - candidateMeanCloud) / 100) : 1;

    const similarityScore = seasonDist * 0.15 + daylightDist * 0.15 + weatherDist * 0.35 + cloudDist * 0.35;

    const normalizedShape = entry.energyByBucket.map((value) => value / totalEnergy);

    candidates.push({ dateUtc: candidateDate.toISOString().slice(0, 10), similarityScore, normalizedShape });
  }

  candidates.sort((a, b) => a.similarityScore - b.similarityScore);
  return candidates.slice(0, count);
}

/** Cached for 6 hours per plant+target-day+weather-bucket — see `calibration.ts`'s identical rationale. */
export const getAnalogDays = unstable_cache(computeAnalogDaysUncached, ["pv-forecast-analog-days"], {
  revalidate: 21_600,
});

export function averageAnalogShape(analogDays: AnalogDay[]): number[] | null {
  if (analogDays.length === 0) {
    return null;
  }

  const shape = new Array<number>(BUCKETS_PER_DAY).fill(0);
  for (const day of analogDays) {
    for (let i = 0; i < BUCKETS_PER_DAY; i += 1) {
      shape[i]! += (day.normalizedShape[i] ?? 0) / analogDays.length;
    }
  }
  return shape;
}

export { BUCKETS_PER_DAY as ANALOG_BUCKETS_PER_DAY, bucketIndex as analogBucketIndex };
