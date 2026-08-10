import { test, expect } from "@playwright/test";

import { detectProductionCollapse } from "@/lib/forecast/analog-days";

/**
 * Atlanta forecast regression investigation. Regression coverage for
 * `detectProductionCollapse`, the analog-day quality filter added after
 * finding two real historical candidates (2026-07-19, 2026-07-20) that
 * passed every existing check (>=80% valid-bucket fraction, positive
 * total energy) yet had physically implausible shapes - confirmed via
 * their real bucket-level data (see this function's own doc comment in
 * `analog-days.ts`). These fixtures reproduce the same signatures at a
 * reduced scale (24 daylight buckets instead of ~57-61) so the tests
 * stay readable while exercising the exact same detection logic.
 *
 * Pure-function tests, no DB/browser/network - see
 * `forecast-weather-interpolation.spec.ts` for why this suite hosts these.
 */

const DAYLIGHT = Array.from({ length: 24 }, (_, i) => i); // buckets 0-23 are "daylight" for these fixtures

test.describe("detectProductionCollapse", () => {
  test("a smooth, real-looking bell-curve day is never flagged", () => {
    // Roughly triangular ramp-up/ramp-down, peak in the middle - no dip.
    const shape = [0, 2, 4, 8, 12, 18, 24, 30, 34, 36, 38, 39, 39, 38, 36, 34, 30, 24, 18, 12, 8, 4, 2, 0];
    expect(detectProductionCollapse(shape, DAYLIGHT)).toBeNull();
  });

  test("a 2026-07-19-style extended flatline bounded by real production on both sides is flagged", () => {
    // Ramps up to a real level, collapses to near-zero for many buckets, then jumps to a real peak.
    const shape = [0, 1, 3, 6, 8, 8, 8, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 20, 23, 19, 17, 5, 2, 1, 0];
    const reason = detectProductionCollapse(shape, DAYLIGHT);
    expect(reason).not.toBeNull();
    expect(reason).toMatch(/unexplained production collapse/);
  });

  test("a 2026-07-20-style brief dropout-and-recovery bounded by near-peak values is flagged", () => {
    // Clear-sky-level production, an abrupt near-total dropout for a couple of buckets, then an immediate return to clear-sky levels.
    const shape = [0, 2, 6, 14, 22, 28, 32, 36, 38, 39, 0.05, 0.04, 39, 38, 36, 32, 28, 22, 14, 6, 2, 0, 0, 0];
    const reason = detectProductionCollapse(shape, DAYLIGHT);
    expect(reason).not.toBeNull();
    expect(reason).toMatch(/unexplained production collapse/);
  });

  test("a gradual, noisy cloudy day that never collapses below 15% of its own peak is not flagged", () => {
    // Two soft humps (scattered clouds) - real variation, but the trough
    // between them never drops below LOW_FRACTION_OF_PEAK, unlike the
    // near-total collapses above.
    const shape = [0, 1, 3, 6, 8, 9, 8, 6, 4, 3, 3, 3, 3, 3, 3, 4, 6, 8, 9, 8, 6, 3, 1, 0];
    expect(detectProductionCollapse(shape, DAYLIGHT)).toBeNull();
  });

  test("low values only at the sunrise/sunset edges (not bounded on both sides) are not flagged", () => {
    // Ramp starts low (dawn) and ends low (dusk) - never bounded by high production on BOTH sides.
    const shape = [0.1, 0.1, 0.2, 0.5, 2, 6, 12, 20, 28, 34, 38, 39, 39, 38, 34, 28, 20, 12, 6, 2, 0.5, 0.2, 0.1, 0.1];
    expect(detectProductionCollapse(shape, DAYLIGHT)).toBeNull();
  });

  test("no daylight buckets means no verdict (never throws)", () => {
    expect(detectProductionCollapse([1, 2, 3], [])).toBeNull();
  });

  test("an all-zero day (no peak) is not flagged here - that's the separate totalEnergy<=0 check's job", () => {
    expect(detectProductionCollapse(new Array(24).fill(0), DAYLIGHT)).toBeNull();
  });
});
