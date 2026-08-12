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
  /** This day's own real reconstructed Available PV total, kWh — the exact same Zero-Export-independent source (`reconstructAvailablePv`) the forecast's calibration layer already trusts, never a second "actual" accounting. Already computed below to build `normalizedShape`; exposed so a caller can anchor the analog component's absolute magnitude to real history instead of only its intraday shape (Aug 2026 MEDIUM/LONG realism investigation). */
  totalEnergyKwh: number;
};

export type AnalogDayRejection = { dateUtc: string; reason: string };

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

/**
 * Atlanta forecast regression investigation - evidence-based quality
 * filter. `MIN_VALID_BUCKET_FRACTION` alone doesn't catch a real defect
 * found in production: two candidate days (2026-07-19, 2026-07-20) passed
 * every existing check (97.6% valid-bucket fraction, positive total
 * energy) yet had physically implausible bucket-level shapes - confirmed
 * by inspecting their raw 15-minute Available PV directly:
 *
 * - 2026-07-20: a plant producing near-clear-sky output (30-38 kWh/bucket)
 *   dropped to ~0.03 kWh/bucket for exactly 4 consecutive buckets, then
 *   jumped straight back to 25-38 kWh/bucket - a near-instantaneous
 *   full-scale dropout-and-recovery, not a gradual cloud transition.
 * - 2026-07-19: production collapsed to ~3% of that day's own peak for a
 *   continuous 6.5-hour stretch bounded on both sides by 30%+-of-peak
 *   readings (a real morning ramp before, a real afternoon peak after) -
 *   implausible for genuine weather (clouds don't clear a plant's output
 *   to near-nothing for 6+ hours and then instantly restore it).
 *
 * Both are the same underlying signature: a run of buckets collapsed to
 * a small fraction of the day's own peak, bounded on both sides (not at
 * the sunrise/sunset edges) by buckets that prove the plant was already
 * capable of meaningful production shortly before AND shortly after -
 * i.e. an unexplained mid-day collapse, not a cloud-driven decline (which
 * doesn't recover to near-peak within minutes to a few hours on both
 * sides of a total blackout). `LOW_FRACTION_OF_PEAK`/`RECOVERY_FRACTION_OF_PEAK`
 * were chosen by checking every real candidate this session actually
 * selected: 0.15/0.30 separates both confirmed-bad days from every
 * legitimately-cloudy day in the same 40-day window (including
 * 2026-07-25, kept as valid - its dip is bounded by a slow, multi-hour
 * recovery, never a sharp back-to-peak jump).
 */
const LOW_FRACTION_OF_PEAK = 0.15;
const RECOVERY_FRACTION_OF_PEAK = 0.3;
const RECOVERY_LOOKAROUND_BUCKETS = 3;
const MIN_COLLAPSE_RUN_BUCKETS = 2;

/**
 * Scans a day's own daylight-bucket energies for an unexplained mid-day
 * production collapse (see this module's own doc comment above). Returns
 * a human-readable reason when found, `null` when the day's shape is
 * plausible. Pure/deterministic - a function of this one day's own
 * energy values only.
 */
export function detectProductionCollapse(dailyEnergyByBucket: number[], daylightBucketIndices: number[]): string | null {
  if (daylightBucketIndices.length === 0) {
    return null;
  }

  const daylightEnergies = daylightBucketIndices.map((b) => dailyEnergyByBucket[b] ?? 0);
  const peak = Math.max(...daylightEnergies);
  if (peak <= 0) {
    return null;
  }

  const lowThreshold = peak * LOW_FRACTION_OF_PEAK;
  const recoveryThreshold = peak * RECOVERY_FRACTION_OF_PEAK;

  let runStart = -1;
  for (let i = 0; i <= daylightEnergies.length; i += 1) {
    const isLow = i < daylightEnergies.length && daylightEnergies[i]! < lowThreshold;
    if (isLow && runStart === -1) {
      runStart = i;
      continue;
    }
    if (!isLow && runStart !== -1) {
      const runEnd = i - 1; // inclusive, indices into daylightEnergies
      const runLength = runEnd - runStart + 1;

      if (runLength >= MIN_COLLAPSE_RUN_BUCKETS) {
        const beforeStart = Math.max(0, runStart - RECOVERY_LOOKAROUND_BUCKETS);
        const afterEnd = Math.min(daylightEnergies.length - 1, runEnd + RECOVERY_LOOKAROUND_BUCKETS);
        const before = daylightEnergies.slice(beforeStart, runStart);
        const after = daylightEnergies.slice(runEnd + 1, afterEnd + 1);
        const beforeMax = before.length > 0 ? Math.max(...before) : 0;
        const afterMax = after.length > 0 ? Math.max(...after) : 0;

        // Bounded on both sides (not a sunrise/sunset edge) by production
        // that proves the plant was already capable of meaningful output
        // shortly before AND shortly after the collapse.
        if (before.length > 0 && after.length > 0 && beforeMax >= recoveryThreshold && afterMax >= recoveryThreshold) {
          const runHours = Math.round((runLength * BUCKET_MINUTES) / 60 * 100) / 100;
          return `unexplained production collapse: ${runHours}h at <${Math.round(LOW_FRACTION_OF_PEAK * 100)}% of peak, bounded by >${Math.round(RECOVERY_FRACTION_OF_PEAK * 100)}% of peak on both sides`;
        }
      }
      runStart = -1;
    }
  }

  return null;
}

export type AnalogDaysResult = { candidates: AnalogDay[]; rejected: AnalogDayRejection[] };

export async function computeAnalogDaysUncached(params: {
  plantId: string;
  organizationId: string;
  latitude: number;
  longitude: number;
  targetDateUtc: string;
  targetMeanGhi: number;
  targetMeanCloudCover: number;
  count: number;
}): Promise<AnalogDaysResult> {
  const { plantId, organizationId, latitude, longitude, count } = params;
  const targetDate = dayStartUtc(new Date(params.targetDateUtc));
  const historyStart = new Date(targetDate.getTime() - LOOKBACK_DAYS * DAY_MS);
  // Exclusive of the target day itself — analog candidates are always
  // strictly in the past relative to what's being forecast.
  const historyEnd = new Date(Math.min(targetDate.getTime(), Date.now()));

  if (historyEnd.getTime() <= historyStart.getTime()) {
    return { candidates: [], rejected: [] };
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
  const rejected: AnalogDayRejection[] = [];

  for (const [dayKey, entry] of byDay) {
    const candidateDate = new Date(dayKey);
    const dateUtc = candidateDate.toISOString().slice(0, 10);
    const validFraction = entry.validBuckets / (BUCKETS_PER_DAY * expectedSamplesPerBucket);
    if (validFraction < MIN_VALID_BUCKET_FRACTION) {
      rejected.push({ dateUtc, reason: `insufficient telemetry coverage: ${Math.round(validFraction * 1000) / 10}% of expected samples (need >=${MIN_VALID_BUCKET_FRACTION * 100}%)` });
      continue;
    }

    const totalEnergy = entry.energyByBucket.reduce((sum, value) => sum + value, 0);
    if (totalEnergy <= 0) {
      rejected.push({ dateUtc, reason: "zero total energy" });
      continue;
    }

    const candidateDaylightWindow = sunriseSunsetUtc(candidateDate, latitude, longitude);
    const daylightBucketIndices: number[] = [];
    if (candidateDaylightWindow) {
      for (let b = 0; b < BUCKETS_PER_DAY; b += 1) {
        const bucketStart = new Date(dayKey + b * BUCKET_MINUTES * 60_000);
        if (
          bucketStart.getTime() >= candidateDaylightWindow.sunrise.getTime() &&
          bucketStart.getTime() < candidateDaylightWindow.sunset.getTime()
        ) {
          daylightBucketIndices.push(b);
        }
      }
    }

    const collapseReason = detectProductionCollapse(entry.energyByBucket, daylightBucketIndices);
    if (collapseReason) {
      rejected.push({ dateUtc, reason: collapseReason });
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

    candidates.push({ dateUtc, similarityScore, normalizedShape, totalEnergyKwh: totalEnergy });
  }

  candidates.sort((a, b) => a.similarityScore - b.similarityScore);
  // Never pad with rejected candidates just to reach `count` - fewer (or
  // zero) valid candidates is the correct, honest outcome when that's all
  // the history genuinely supports; `averageAnalogShape([])` already
  // degrades to `null`, which the caller already treats as "no analog
  // component this run" rather than fabricating one.
  return { candidates: candidates.slice(0, count), rejected };
}

/**
 * Classic Savitzky-Golay quartic/quintic smoothing coefficients for a
 * 7-point window (published, e.g. Savitzky & Golay 1964; Numerical
 * Recipes' SG smoothing tables, order-4 row) - not a tuned/arbitrary
 * weighting. A first attempt at this fix used the simpler 5-point
 * quadratic/cubic SG filter ([-3,12,17,12,-3]/35); backtested against 24
 * real days of both plants' actual production, it cut Atlanta's
 * intraday jaggedness by ~43-55% but still cost ~5.8%/1.11 kW of
 * peak-tracking accuracy (Aug 2026 jaggedness-fix follow-up) - a real,
 * disclosed, but not-yet-acceptable trade-off. A higher-order fit through
 * a wider window is the standard, principled way to buy back peak
 * fidelity from an SG filter: a quartic can flex to follow real local
 * curvature (a genuine parabola- or higher-order-shaped peak/valley)
 * far more precisely than a quadratic can, while still being a genuine
 * low-pass filter that damps single-bucket noise not well-fit by any
 * smooth quartic. Re-backtested against the same 24 real days: recovers
 * materially more of the peak accuracy while retaining most of the
 * jaggedness reduction (see that investigation's numbers for the exact
 * before/after).
 */
const SAVITZKY_GOLAY_7_COEFFICIENTS = [5, -30, 75, 131, 75, -30, 5];
const SAVITZKY_GOLAY_7_NORMALIZATION = 231;
const SAVITZKY_GOLAY_HALF_WINDOW = 3;

/**
 * Shape-smoothing fix (Aug 2026 jagged-curve investigation): the averaged
 * shape is built directly from real historical 15-minute telemetry, which
 * carries genuine sample-to-sample noise (cloud transients, sensor
 * jitter) — confirmed as the dominant cause of high-frequency zig-zag on
 * analog-active forecast days, since it gets blended at MEDIUM/LONG
 * tier's high `analogWeight` unchanged.
 *
 * Never blends across the sunrise/sunset edge: a bucket whose own value
 * is already 0 (no analog day produced anything there — true night) is
 * left at exactly 0. A neighbor that's out of array range or itself 0
 * (true night, or a day that hasn't started yet) is replaced by THIS
 * bucket's own value rather than 0 — so a bucket near the boundary is
 * pulled toward itself, not toward darkness, which both preserves the
 * daylight window's start/end exactly and makes the filter progressively
 * closer to identity (more peak-preserving) as it nears the edge of
 * daylight, exactly the right behavior for a sunrise/sunset ramp. Clamped
 * at 0 (the two negative end-coefficients can, in principle, push a
 * value slightly negative next to an extreme discontinuity — never
 * observed in real data, but structurally guarded against regardless).
 * Renormalized afterward so the shape still sums to 1, preserving the
 * exact contract `pv-forecast-core.ts`'s magnitude-anchoring blend
 * depends on: shape only ever redistributes an already-decided daily
 * total kWh, never changes it.
 */
export function smoothNormalizedShape(shape: number[]): number[] {
  const smoothed = shape.map((value, i) => {
    if (value === 0) {
      return 0;
    }
    let weightedSum = 0;
    for (let offset = -SAVITZKY_GOLAY_HALF_WINDOW; offset <= SAVITZKY_GOLAY_HALF_WINDOW; offset += 1) {
      const neighbor = shape[i + offset];
      const sample = neighbor !== undefined && neighbor > 0 ? neighbor : value;
      weightedSum += sample * SAVITZKY_GOLAY_7_COEFFICIENTS[offset + SAVITZKY_GOLAY_HALF_WINDOW]!;
    }
    return Math.max(0, weightedSum / SAVITZKY_GOLAY_7_NORMALIZATION);
  });

  const total = smoothed.reduce((sum, v) => sum + v, 0);
  if (total <= 0) {
    return shape;
  }
  return smoothed.map((v) => v / total);
}

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
  return smoothNormalizedShape(shape);
}

export { BUCKETS_PER_DAY as ANALOG_BUCKETS_PER_DAY, bucketIndex as analogBucketIndex };
