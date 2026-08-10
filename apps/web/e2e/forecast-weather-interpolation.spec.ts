import { test, expect } from "@playwright/test";

import { interpolateWeatherAt } from "@/lib/forecast/weather-interpolation";
import type { SolarWeatherPoint } from "@/lib/weather/openMeteo";

/**
 * Regression coverage for the Dashboard Week/Month Forecast Correction
 * milestone's root-cause bug: `interpolateWeatherAt` used to clamp ANY
 * out-of-range instant to the nearest edge sample instead of reporting
 * `null`, which silently defeated `weatherOrClearSkyFallback`'s clear-sky
 * fallback for every hour beyond Open-Meteo's real ~48h coverage window —
 * the reason Week/Month forecasts collapsed toward zero a couple of days
 * out. Pure-function tests, no DB/browser/network involved — see this
 * suite's `playwright.config.ts` for why Playwright (not a dedicated unit
 * runner, which apps/web doesn't have) hosts these.
 */

function point(hoursFromEpoch: number, irradiance: number, temperature = 20): SolarWeatherPoint {
  return {
    time: new Date(hoursFromEpoch * 60 * 60 * 1000),
    irradiance,
    cloudCover: 0,
    temperature,
    windSpeed: 0,
    weatherCode: 0,
  };
}

test.describe("interpolateWeatherAt", () => {
  test("interpolates linearly between two bracketing hourly points", () => {
    const points = [point(0, 100), point(1, 200)];
    const result = interpolateWeatherAt(points, new Date(30 * 60 * 1000)); // 30 min in
    expect(result).not.toBeNull();
    expect(result!.irradiance).toBeCloseTo(150, 5);
  });

  test("holds the nearest edge sample within the grace window beyond real coverage", () => {
    const points = [point(0, 100), point(1, 200)];
    // 30 minutes past the last real sample - within the 1h grace window.
    const result = interpolateWeatherAt(points, new Date((1 * 60 + 30) * 60 * 1000));
    expect(result).not.toBeNull();
    expect(result!.irradiance).toBe(200);
  });

  test("returns null (not a clamped value) beyond the grace window - the fixed bug", () => {
    const points = [point(0, 100), point(1, 200)];
    // Open-Meteo's real forecast only covers ~48h; every hour beyond that
    // must report null so the caller's clear-sky fallback engages, instead
    // of silently reusing the last (often near-zero, late-evening) sample.
    const farBeyondCoverage = new Date((1 + 72) * 60 * 60 * 1000); // 72h past the last sample
    const result = interpolateWeatherAt(points, farBeyondCoverage);
    expect(result).toBeNull();
  });

  test("returns null before the first sample's grace window", () => {
    const points = [point(10, 100), point(11, 200)];
    const result = interpolateWeatherAt(points, new Date(0));
    expect(result).toBeNull();
  });

  test("returns null for an empty points array", () => {
    expect(interpolateWeatherAt([], new Date())).toBeNull();
  });
});
