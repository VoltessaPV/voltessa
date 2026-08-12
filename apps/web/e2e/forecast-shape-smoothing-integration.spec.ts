import { test, expect } from "@playwright/test";

import { generatePvForecastCore } from "@/lib/forecast/pv-forecast-core";
import { smoothNormalizedShape } from "@/lib/forecast/analog-days";
import type { HourOfDayCalibration } from "@/lib/forecast/calibration";
import type { SolarWeatherPoint } from "@/lib/weather/openMeteo";

/**
 * Forecast shape-smoothing fix (Aug 2026 jagged-curve investigation).
 * End-to-end confirmation, via the real `generatePvForecastCore` entry
 * point, that shape smoothing changes only the intraday distribution of
 * the analog component - never the day's total energy - and that a
 * SHORT-tier, genuine-real-weather day (where the magnitude-anchoring
 * blend is gated off entirely, per `pv-forecast-core.ts`) is affected by
 * the smoothing in exactly the same way, since `averageAnalogShape` runs
 * identically for every tier.
 */

const LATITUDE = 42.892833; // Atlanta plant's real coordinates - only used for realistic solar geometry.
const LONGITUDE = 24.701003;
const CAPACITY_KW = 200;
const DAY_START = new Date("2026-08-10T00:00:00.000Z");
const HORIZON_END = new Date("2026-08-11T00:00:00.000Z");
const IDENTITY_CALIBRATION: HourOfDayCalibration = { factors: new Map(), sampleCount: 50, lookbackDays: 30 };

function hourlyWeatherPoints(): SolarWeatherPoint[] {
  const points: SolarWeatherPoint[] = [];
  for (let t = DAY_START.getTime() - 3 * 60 * 60 * 1000; t <= HORIZON_END.getTime() + 3 * 60 * 60 * 1000; t += 60 * 60 * 1000) {
    points.push({ time: new Date(t), irradiance: 600, cloudCover: 20, temperature: 25, windSpeed: 2, weatherCode: 1 });
  }
  return points;
}

/**
 * A noisy real-telemetry-like normalized shape (raw, NOT pre-smoothed) -
 * the same shape of fixture `averageAnalogShape` would have produced
 * before this fix. Noise is only applied away from the very dawn/dusk
 * edge (real cloud-transient/telemetry noise is a daytime effect; the
 * edge itself just tapers cleanly toward zero, same as real data always
 * does - a synthetic fixture that instead put full-amplitude alternating
 * noise immediately adjacent to a hard zero-boundary bucket would be
 * testing an artifact of the fixture itself, not real behavior).
 */
function rawNoisyShape(): number[] {
  const shape = new Array<number>(96).fill(0);
  for (let b = 24; b < 72; b += 1) {
    const base = Math.max(0, 24 - Math.abs(b - 48));
    const nearEdge = b < 30 || b >= 66;
    shape[b] = nearEdge ? base : b % 2 === 0 ? base * 1.3 : base * 0.75;
  }
  const total = shape.reduce((s, v) => s + v, 0);
  return shape.map((v) => v / total);
}

function dailyTotalKwh(intervals: ReturnType<typeof generatePvForecastCore>["intervals"]): number {
  return intervals.reduce((s, iv) => s + iv.forecastKwh, 0);
}

function maxAbsConsecutiveJump(intervals: ReturnType<typeof generatePvForecastCore>["intervals"]): number {
  let max = 0;
  for (let i = 1; i < intervals.length; i += 1) {
    max = Math.max(max, Math.abs(intervals[i]!.forecastKw - intervals[i - 1]!.forecastKw));
  }
  return max;
}

test.describe("shape smoothing via generatePvForecastCore (SHORT tier, real weather)", () => {
  test("daily energy is effectively unchanged between a raw and a pre-smoothed analog shape", () => {
    const weatherPoints = hourlyWeatherPoints();
    const rawShape = rawNoisyShape();
    const smoothedShape = smoothNormalizedShape(rawShape);

    const baseParams = {
      plantId: "test-plant",
      latitude: LATITUDE,
      longitude: LONGITUDE,
      capacityKw: CAPACITY_KW,
      now: DAY_START,
      horizonEnd: HORIZON_END,
      weatherPoints,
      calibration: IDENTITY_CALIBRATION,
      analogWeight: 0.5,
      observedElapsedToday: [],
      horizonTier: "SHORT" as const,
    };

    const rawResult = generatePvForecastCore({
      ...baseParams,
      analogShapeByDayUtc: new Map([["2026-08-10", { shape: rawShape, dates: ["2026-07-01"] }]]),
    });
    const smoothedResult = generatePvForecastCore({
      ...baseParams,
      analogShapeByDayUtc: new Map([["2026-08-10", { shape: smoothedShape, dates: ["2026-07-01"] }]]),
    });

    const rawTotal = dailyTotalKwh(rawResult.intervals);
    const smoothedTotal = dailyTotalKwh(smoothedResult.intervals);
    // Both shapes sum to 1 by construction, so the day's total energy
    // (driven entirely by dailyTotalKwh derived from calibratedKw, not by
    // the shape) must be effectively identical - shape only redistributes.
    expect(Math.abs(smoothedTotal - rawTotal) / rawTotal).toBeLessThan(0.01);

    // The intraday curve itself must be measurably smoother.
    expect(maxAbsConsecutiveJump(smoothedResult.intervals)).toBeLessThan(maxAbsConsecutiveJump(rawResult.intervals));
  });

  test("output is deterministic for identical inputs", () => {
    const weatherPoints = hourlyWeatherPoints();
    const shape = smoothNormalizedShape(rawNoisyShape());
    const params = {
      plantId: "test-plant",
      latitude: LATITUDE,
      longitude: LONGITUDE,
      capacityKw: CAPACITY_KW,
      now: DAY_START,
      horizonEnd: HORIZON_END,
      weatherPoints,
      calibration: IDENTITY_CALIBRATION,
      analogShapeByDayUtc: new Map([["2026-08-10", { shape, dates: ["2026-07-01"] }]]),
      analogWeight: 0.5,
      observedElapsedToday: [],
      horizonTier: "SHORT" as const,
    };

    const a = generatePvForecastCore(params);
    const b = generatePvForecastCore(params);
    expect(dailyTotalKwh(a.intervals)).toBe(dailyTotalKwh(b.intervals));
    expect(a.intervals.map((iv) => iv.forecastKw)).toEqual(b.intervals.map((iv) => iv.forecastKw));
  });
});
