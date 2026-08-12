import { test, expect } from "@playwright/test";

import { averageAnalogShape, smoothNormalizedShape, ANALOG_BUCKETS_PER_DAY, type AnalogDay } from "@/lib/forecast/analog-days";

/**
 * Forecast shape-smoothing fix (Aug 2026 jagged-curve investigation).
 * Regression coverage for `smoothNormalizedShape` — confirmed via a full
 * production-data trace that raw historical 15-minute telemetry noise in
 * the averaged analog shape was the dominant cause of Atlanta's intraday
 * zig-zag on analog-active days (e.g. persisted 11:00->11:15 swinging
 * -16.9% with the calibration factor completely unchanged either side,
 * isolating the analog shape as the sole cause of that specific jump).
 *
 * Pure-function tests, no DB/browser/network - see
 * `forecast-weather-interpolation.spec.ts` for why this suite hosts these.
 */

function sum(values: number[]): number {
  return values.reduce((s, v) => s + v, 0);
}

function maxAbsConsecutiveDelta(values: number[]): number {
  let max = 0;
  for (let i = 1; i < values.length; i += 1) {
    max = Math.max(max, Math.abs(values[i]! - values[i - 1]!));
  }
  return max;
}

/** A smooth triangular daylight shape (buckets 24-72, i.e. 06:00-18:00 UTC on a 15-min/96-bucket grid) with no noise - the baseline every noisy fixture below perturbs. */
function smoothBaseShape(): number[] {
  const shape = new Array<number>(ANALOG_BUCKETS_PER_DAY).fill(0);
  for (let b = 24; b < 72; b += 1) {
    shape[b] = Math.max(0, 24 - Math.abs(b - 48));
  }
  const total = sum(shape);
  return shape.map((v) => v / total);
}

/** Same shape with high-frequency noise injected only within the already-nonzero (daylight) span - mirrors real historical telemetry jitter, never fabricating production into night buckets. */
function noisyShape(): number[] {
  const shape = smoothBaseShape();
  return shape.map((v, i) => (v > 0 && i % 2 === 0 ? v * 1.3 : v > 0 ? v * 0.75 : v));
}

test.describe("smoothNormalizedShape", () => {
  test("reduces high-frequency noise relative to the unsmoothed shape", () => {
    const noisy = noisyShape();
    const smoothed = smoothNormalizedShape(noisy);
    expect(maxAbsConsecutiveDelta(smoothed)).toBeLessThan(maxAbsConsecutiveDelta(noisy));
  });

  test("renormalizes so the sum stays 1 after smoothing", () => {
    const smoothed = smoothNormalizedShape(noisyShape());
    expect(sum(smoothed)).toBeCloseTo(1, 6);
  });

  test("never produces a negative value", () => {
    const smoothed = smoothNormalizedShape(noisyShape());
    for (const v of smoothed) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  test("never introduces production into a bucket that was exactly zero (preserves the daylight window boundary)", () => {
    const shape = noisyShape();
    const smoothed = smoothNormalizedShape(shape);
    for (let i = 0; i < shape.length; i += 1) {
      if (shape[i] === 0) {
        expect(smoothed[i]).toBe(0);
      }
    }
  });

  test("does not shift the peak by more than one bucket (15 minutes) on a clean single-peak shape", () => {
    const shape = smoothBaseShape();
    const smoothed = smoothNormalizedShape(shape);
    const originalPeakIndex = shape.indexOf(Math.max(...shape));
    const smoothedPeakIndex = smoothed.indexOf(Math.max(...smoothed));
    expect(Math.abs(smoothedPeakIndex - originalPeakIndex)).toBeLessThanOrEqual(1);
  });

  test("preserves a genuine short-lived production peak (parabola-shaped) better than a flat moving average would", () => {
    // A brief, real cloud-edge-brightening-style peak superimposed on the
    // broad daily shape: 3 buckets shaped like a local parabola bump - the
    // exact case a flat moving average flattens but a quadratic
    // Savitzky-Golay fit reproduces almost exactly (this is the whole
    // reason for the redesign - see this module's own doc comment).
    const shape = smoothBaseShape();
    const bumpCenter = 40; // within the daylight span, away from the main peak at 48
    shape[bumpCenter - 1] = shape[bumpCenter - 1]! + 6;
    shape[bumpCenter] = shape[bumpCenter]! + 10;
    shape[bumpCenter + 1] = shape[bumpCenter + 1]! + 6;
    const total = sum(shape);
    const normalized = shape.map((v) => v / total);

    const flatAverage = normalized.map((value, i) => {
      if (value === 0) return 0;
      const prev = normalized[i - 1] ?? 0;
      const next = normalized[i + 1] ?? 0;
      const samples = [value, prev > 0 ? prev : value, next > 0 ? next : value];
      return samples.reduce((s, v) => s + v, 0) / samples.length;
    });
    const flatAverageRenormalized = (() => {
      const t = sum(flatAverage);
      return flatAverage.map((v) => v / t);
    })();

    const sgSmoothed = smoothNormalizedShape(normalized);

    // Both filters reduce the bump somewhat (any smoothing does), but the
    // Savitzky-Golay filter must retain a materially larger share of the
    // bump's own height than a flat 3-point average does.
    const originalBumpHeight = normalized[bumpCenter]! - normalized[bumpCenter - 4]!;
    const sgBumpHeight = sgSmoothed[bumpCenter]! - sgSmoothed[bumpCenter - 4]!;
    const flatBumpHeight = flatAverageRenormalized[bumpCenter]! - flatAverageRenormalized[bumpCenter - 4]!;

    expect(sgBumpHeight).toBeGreaterThan(flatBumpHeight);
    expect(sgBumpHeight / originalBumpHeight).toBeGreaterThan(0.8);
  });

  test("a genuinely smooth shape is left effectively unchanged (no overshoot introduced)", () => {
    const shape = smoothBaseShape();
    const smoothed = smoothNormalizedShape(shape);
    for (let i = 0; i < shape.length; i += 1) {
      expect(smoothed[i]).toBeLessThanOrEqual(Math.max(shape[i - 1] ?? shape[i]!, shape[i]!, shape[i + 1] ?? shape[i]!) + 1e-9);
    }
  });

  test("deterministic: identical input always produces identical output", () => {
    const shape = noisyShape();
    const a = smoothNormalizedShape(shape);
    const b = smoothNormalizedShape([...shape]);
    expect(a).toEqual(b);
  });

  test("an all-zero shape is returned unchanged rather than dividing by zero", () => {
    const zero = new Array<number>(ANALOG_BUCKETS_PER_DAY).fill(0);
    expect(smoothNormalizedShape(zero)).toEqual(zero);
  });
});

test.describe("averageAnalogShape (end-to-end with smoothing applied)", () => {
  function fixtureDay(dateUtc: string, shape: number[], totalEnergyKwh: number): AnalogDay {
    return { dateUtc, similarityScore: 0.1, normalizedShape: shape, totalEnergyKwh };
  }

  test("averaging noisy real-looking candidate days still sums to 1 and stays non-negative", () => {
    const day1 = fixtureDay("2026-07-01", noisyShape(), 900);
    const day2 = fixtureDay("2026-07-02", smoothBaseShape(), 950);
    const averaged = averageAnalogShape([day1, day2]);
    expect(averaged).not.toBeNull();
    expect(sum(averaged!)).toBeCloseTo(1, 6);
    for (const v of averaged!) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  test("smoothing measurably reduces jaggedness for a multi-day noisy average vs the pre-smoothing raw average", () => {
    const day1 = fixtureDay("2026-07-01", noisyShape(), 900);
    const day2 = fixtureDay("2026-07-02", noisyShape(), 920);
    const day3 = fixtureDay("2026-07-03", noisyShape(), 880);
    const smoothedAverage = averageAnalogShape([day1, day2, day3])!;

    // Reproduce the OLD (pre-fix) raw average directly, for comparison.
    const rawAverage = new Array<number>(ANALOG_BUCKETS_PER_DAY).fill(0);
    for (const day of [day1, day2, day3]) {
      for (let i = 0; i < ANALOG_BUCKETS_PER_DAY; i += 1) {
        rawAverage[i]! += (day.normalizedShape[i] ?? 0) / 3;
      }
    }

    expect(maxAbsConsecutiveDelta(smoothedAverage)).toBeLessThan(maxAbsConsecutiveDelta(rawAverage));
  });
});
