import { test, expect } from "@playwright/test";

import { applyHourOfDayCalibration, interpolatedHourOfDayFactor, type HourOfDayCalibration } from "@/lib/forecast/calibration";

/**
 * Forecast shape-smoothing fix (Aug 2026 jagged-curve investigation).
 * Regression coverage for `interpolatedHourOfDayFactor` — confirmed via a
 * full production-data trace that the previous direct `factors.get(hour)`
 * lookup produced a hard step at every hour boundary (e.g. Chomakovtsi's
 * persisted forecast jumped -50.5% at exactly 15:45->16:00, matching
 * calibFactor 0.789->0.500 with nothing else in the pipeline changing).
 * These tests only exercise the interpolation itself — the fitting
 * function (`computeHourOfDayCalibrationUncached`) is untouched.
 *
 * Pure-function tests, no DB/browser/network - see
 * `forecast-weather-interpolation.spec.ts` for why this suite hosts these.
 */

function calibration(factors: Record<number, number>): HourOfDayCalibration {
  return { factors: new Map(Object.entries(factors).map(([h, f]) => [Number(h), f])), sampleCount: 100, lookbackDays: 60 };
}

test.describe("interpolatedHourOfDayFactor", () => {
  test("interpolates linearly across an hour boundary", () => {
    const cal = calibration({ 10: 1.2, 11: 1.4 });
    expect(interpolatedHourOfDayFactor(cal, new Date("2026-08-11T10:00:00.000Z"))).toBeCloseTo(1.2, 6);
    expect(interpolatedHourOfDayFactor(cal, new Date("2026-08-11T10:15:00.000Z"))).toBeCloseTo(1.25, 6);
    expect(interpolatedHourOfDayFactor(cal, new Date("2026-08-11T10:30:00.000Z"))).toBeCloseTo(1.3, 6);
    expect(interpolatedHourOfDayFactor(cal, new Date("2026-08-11T10:45:00.000Z"))).toBeCloseTo(1.35, 6);
  });

  test("a declining factor sequence (real Chomakovtsi 15:00/16:00 shape) interpolates smoothly instead of stepping", () => {
    const cal = calibration({ 15: 0.789, 16: 0.5 });
    const at1545 = interpolatedHourOfDayFactor(cal, new Date("2026-08-11T15:45:00.000Z"));
    const at1600 = interpolatedHourOfDayFactor(cal, new Date("2026-08-11T16:00:00.000Z"));
    // Old step-function behavior would have jumped directly from 0.789 to
    // 0.500 at exactly this boundary - the fixed 15:45 value must sit
    // strictly between the two hourly anchors, close to (but not at) 0.5.
    expect(at1545).toBeGreaterThan(0.5);
    expect(at1545).toBeLessThan(0.789);
    expect(at1600).toBeCloseTo(0.5, 6);
  });

  test("midnight 23->00 wraps around correctly", () => {
    const cal = calibration({ 23: 0.6, 0: 1.0 });
    expect(interpolatedHourOfDayFactor(cal, new Date("2026-08-11T23:00:00.000Z"))).toBeCloseTo(0.6, 6);
    expect(interpolatedHourOfDayFactor(cal, new Date("2026-08-11T23:30:00.000Z"))).toBeCloseTo(0.8, 6);
    expect(interpolatedHourOfDayFactor(cal, new Date("2026-08-12T00:00:00.000Z"))).toBeCloseTo(1.0, 6);
  });

  test("preserves exact fitted values at every anchor (:00 mark)", () => {
    const cal = calibration({ 6: 1.09, 7: 1.11, 8: 1.108, 9: 1.093 });
    for (const hour of [6, 7, 8, 9]) {
      const at = interpolatedHourOfDayFactor(cal, new Date(`2026-08-11T${String(hour).padStart(2, "0")}:00:00.000Z`));
      expect(at).toBeCloseTo(cal.factors.get(hour)!, 10);
    }
  });

  test("a missing hour still defaults to 1 (no fabricated correction), exactly as before", () => {
    const cal = calibration({ 10: 1.2 }); // hour 11 has no fitted factor
    expect(interpolatedHourOfDayFactor(cal, new Date("2026-08-11T11:00:00.000Z"))).toBeCloseTo(1, 6);
    // Blends from the fitted hour 10 toward the unfitted (=1) hour 11.
    expect(interpolatedHourOfDayFactor(cal, new Date("2026-08-11T10:30:00.000Z"))).toBeCloseTo(1.1, 6);
  });

  test("deterministic: identical inputs always produce identical output", () => {
    const cal = calibration({ 12: 1.05, 13: 0.98 });
    const t = new Date("2026-08-11T12:37:00.000Z");
    const a = interpolatedHourOfDayFactor(cal, t);
    const b = interpolatedHourOfDayFactor(cal, new Date(t.getTime()));
    expect(a).toBe(b);
  });

  test("applyHourOfDayCalibration multiplies physicalWeatherKw by the interpolated factor, not the old step value", () => {
    const cal = calibration({ 15: 0.789, 16: 0.5 });
    const kw = applyHourOfDayCalibration(cal, new Date("2026-08-11T15:45:00.000Z"), 100);
    expect(kw).toBeCloseTo(100 * (0.789 + 0.75 * (0.5 - 0.789)), 6);
    expect(kw).not.toBeCloseTo(78.9, 1); // old step behavior would have stayed flat at the 15:00 anchor
  });
});
