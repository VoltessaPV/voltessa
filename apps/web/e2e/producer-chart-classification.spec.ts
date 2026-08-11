import { test, expect } from "@playwright/test";

import { hasMeaningfulGridData } from "@/components/dashboard/producer-chart-classification";

/**
 * Forecast Semantics & Measurement Accuracy milestone, item 6 (Producer
 * plants show only PV series). Regression coverage for
 * `hasMeaningfulGridData` — see that module's own top doc comment for the
 * real-data evidence behind the threshold (Atlanta's real August 2026
 * import ratio of 7.6%-16.6% of daily production).
 *
 * Pure-function tests, no DB/browser/network - see
 * `forecast-weather-interpolation.spec.ts` for why this suite hosts these.
 */

test.describe("hasMeaningfulGridData", () => {
  test("F. a plant with no meter at all (every field null) is producer-only", () => {
    const data = Array.from({ length: 96 }, () => ({ pvKw: null, consumptionKw: null }));
    expect(hasMeaningfulGridData(data)).toBe(false);
  });

  test("F. a plant with real PV but zero recorded consumption is producer-only", () => {
    const data = [
      { pvKw: 100, consumptionKw: 0 },
      { pvKw: 150, consumptionKw: 0 },
      { pvKw: 120, consumptionKw: null },
    ];
    expect(hasMeaningfulGridData(data)).toBe(false);
  });

  test("a plant whose consumption is genuinely negligible noise (well under the threshold) stays producer-only", () => {
    // 1% of total PV - meter-transition-style noise, not a real load.
    const data = [
      { pvKw: 1000, consumptionKw: 10 },
      { pvKw: 1000, consumptionKw: 10 },
    ];
    expect(hasMeaningfulGridData(data)).toBe(false);
  });

  test("Atlanta's real observed range (7.6%-16.6% of daily production) is classified as having meaningful grid data", () => {
    // Mirrors the real August 2026 investigation numbers directly: a day
    // with ~236 kWh production and ~44 kWh combined self-consumption+import
    // (the lowest observed ratio, ~18.5%) must still clear the threshold.
    const data = [
      { pvKw: 236, consumptionKw: 43.6 },
    ];
    expect(hasMeaningfulGridData(data)).toBe(true);
  });

  test("no PV at all (zero denominator) is producer-only, never a division artifact", () => {
    const data = [
      { pvKw: 0, consumptionKw: 5 },
      { pvKw: null, consumptionKw: 5 },
    ];
    expect(hasMeaningfulGridData(data)).toBe(false);
  });

  test("exactly at the threshold is NOT meaningful (strict greater-than)", () => {
    const data = [{ pvKw: 100, consumptionKw: 2 }]; // exactly 2%
    expect(hasMeaningfulGridData(data)).toBe(false);
  });

  test("just above the threshold is meaningful", () => {
    const data = [{ pvKw: 100, consumptionKw: 2.01 }];
    expect(hasMeaningfulGridData(data)).toBe(true);
  });
});
