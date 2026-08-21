import { test, expect } from "@playwright/test";

import {
  computeGenuineVintageDays,
  selectBestShortTierRowPerInterval,
  shouldRetrain,
  MIN_NEW_VINTAGE_DAYS_TO_RETRAIN,
  MIN_QUALIFYING_SLOTS_PER_DAY,
  TARGET_D1_LEAD_MINUTES,
} from "@/lib/forecast/ml/genuine-vintage";

/**
 * Continuous Retraining Loop milestone. Pure-function tests for the fixed
 * TRUE_VINTAGE eligibility definition and the conservative retraining
 * eligibility gate — no DB, no browser, no network (see
 * `forecast-bucket-aggregation.spec.ts`'s own top doc comment for why this
 * suite, not a dedicated unit-test runner, hosts these).
 *
 * The bug this suite specifically guards against: the OLD eligibility
 * check counted every reconciled `PvForecastRecord` row for a calendar day
 * and required exactly 96. In production, once the twice-daily refresh has
 * run more than once against the same future day (the permanent, normal
 * state), a day accumulates rows from MANY overlapping vintages — Atlanta's
 * 2026-08-14 alone had 847 rows from 10 distinct vintages. The old check
 * could therefore never match again once the system reached steady state.
 * `computeGenuineVintageDays`'s job is to make that scenario qualify
 * correctly by deduplicating per INTERVAL first.
 */

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

function dayIntervalKeys(dayStart: Date): Date[] {
  return Array.from({ length: 96 }, (_, i) => new Date(dayStart.getTime() + i * FIFTEEN_MIN_MS));
}

test.describe("selectBestShortTierRowPerInterval", () => {
  test("picks the row closest to a genuine 24h (D+1) lead time when multiple vintages cover the same interval", () => {
    const target = new Date("2026-08-14T13:30:00.000Z");
    const rows = [
      { targetIntervalStart: target, leadTimeMinutes: 60 }, // 1h lead - a same-day intraday correction
      { targetIntervalStart: target, leadTimeMinutes: TARGET_D1_LEAD_MINUTES - 10 }, // ~24h lead - the genuine D+1 candidate
      { targetIntervalStart: target, leadTimeMinutes: 47 * 60 }, // 47h lead - still SHORT tier, but far from D+1
    ];

    const result = selectBestShortTierRowPerInterval(rows);

    expect(result).toHaveLength(1);
    expect(result[0]!.leadTimeMinutes).toBe(TARGET_D1_LEAD_MINUTES - 10);
  });

  test("regression: the real Atlanta 2026-08-14 shape (10 overlapping vintages for one day) collapses to at most 96 rows, one per interval - never inflated", () => {
    const dayStart = new Date("2026-08-14T00:00:00.000Z");
    const intervals = dayIntervalKeys(dayStart);
    const rows: { targetIntervalStart: Date; leadTimeMinutes: number }[] = [];
    // Simulate 10 distinct vintages (issued at 4h increments before this day), each re-forecasting
    // every interval it can still reach - exactly the real overlap pattern confirmed in production.
    for (let vintage = 0; vintage < 10; vintage += 1) {
      const issuedAt = new Date(dayStart.getTime() - vintage * 4 * 60 * 60 * 1000);
      for (const target of intervals) {
        const leadTimeMinutes = (target.getTime() - issuedAt.getTime()) / 60_000;
        if (leadTimeMinutes >= 0 && leadTimeMinutes <= 48 * 60) {
          rows.push({ targetIntervalStart: target, leadTimeMinutes });
        }
      }
    }
    expect(rows.length).toBeGreaterThan(96); // reproduces the "847 rows for one day" production shape

    const result = selectBestShortTierRowPerInterval(rows);

    expect(result.length).toBeLessThanOrEqual(96);
    const distinctSlots = new Set(result.map((r) => r.targetIntervalStart.getTime()));
    expect(distinctSlots.size).toBe(result.length); // never two rows for the same interval
  });
});

test.describe("computeGenuineVintageDays", () => {
  test("a day with all 96 interval slots covered (even by many overlapping vintages) qualifies exactly once", () => {
    const dayStart = new Date("2026-08-14T00:00:00.000Z");
    const intervals = dayIntervalKeys(dayStart);
    // Every interval covered by 3 separate (already-deduplicated-by-caller-irrelevant) rows - this
    // function itself must dedupe by interval when counting, not just when a caller pre-filters.
    const rows = intervals.flatMap((t) => [{ targetIntervalStart: t }, { targetIntervalStart: t }, { targetIntervalStart: t }]);

    const days = computeGenuineVintageDays(rows);

    expect(days).toEqual(["2026-08-14"]);
  });

  test("a day with 93/96 distinct interval slots qualifies - matches the real production shape (3 permanently-unreconciled dusk intervals every day, see MIN_QUALIFYING_SLOTS_PER_DAY's own doc comment)", () => {
    const dayStart = new Date("2026-08-13T00:00:00.000Z");
    const intervals = dayIntervalKeys(dayStart).slice(0, 93); // the exact real Atlanta shape confirmed against production
    const rows = intervals.map((t) => ({ targetIntervalStart: t }));

    const days = computeGenuineVintageDays(rows);

    expect(days).toEqual(["2026-08-13"]);
  });

  test("a day with fewer than MIN_QUALIFYING_SLOTS_PER_DAY distinct interval slots does NOT qualify (genuine partial reconciliation, not the normal dusk-gap case)", () => {
    const dayStart = new Date("2026-08-21T00:00:00.000Z");
    const intervals = dayIntervalKeys(dayStart).slice(0, MIN_QUALIFYING_SLOTS_PER_DAY - 1);
    const rows = intervals.map((t) => ({ targetIntervalStart: t }));

    const days = computeGenuineVintageDays(rows);

    expect(days).toEqual([]);
  });

  test("exactly at the MIN_QUALIFYING_SLOTS_PER_DAY threshold qualifies (boundary is inclusive)", () => {
    const dayStart = new Date("2026-08-15T00:00:00.000Z");
    const intervals = dayIntervalKeys(dayStart).slice(0, MIN_QUALIFYING_SLOTS_PER_DAY);
    const rows = intervals.map((t) => ({ targetIntervalStart: t }));

    expect(computeGenuineVintageDays(rows)).toEqual(["2026-08-15"]);
  });

  test("multiple days are evaluated independently and returned sorted", () => {
    const day1 = new Date("2026-08-10T00:00:00.000Z");
    const day2 = new Date("2026-08-12T00:00:00.000Z");
    const day3 = new Date("2026-08-11T00:00:00.000Z"); // only 50 slots - should not qualify

    const rows = [
      ...dayIntervalKeys(day1).map((t) => ({ targetIntervalStart: t })),
      ...dayIntervalKeys(day2).map((t) => ({ targetIntervalStart: t })),
      ...dayIntervalKeys(day3).slice(0, 50).map((t) => ({ targetIntervalStart: t })),
    ];

    const days = computeGenuineVintageDays(rows);

    expect(days).toEqual(["2026-08-10", "2026-08-12"]);
  });

  test("empty input yields no qualifying days, never a crash", () => {
    expect(computeGenuineVintageDays([])).toEqual([]);
  });
});

test.describe("shouldRetrain — conservative, data-driven retraining gate", () => {
  test("insufficient new data across all plants combined -> do not retrain", () => {
    // 2 + 1 = 3 new genuine vintage days total, below the default minimum.
    expect(shouldRetrain([2, 1])).toBe(false);
  });

  test("sufficient new data (exactly at the threshold) -> retrain", () => {
    expect(shouldRetrain([MIN_NEW_VINTAGE_DAYS_TO_RETRAIN])).toBe(true);
  });

  test("sufficient new data, combined across BOTH plants (global training - neither plant alone need reach the threshold)", () => {
    // Atlanta contributes 3, Chomakovtsi contributes 3 - neither alone reaches the default
    // minimum of 5, but the GLOBAL model trains on both plants' data together, so the combined
    // total is what matters - confirms retraining is evaluated globally, not gated per plant.
    const perPlant = [3, 3];
    expect(perPlant[0]).toBeLessThan(MIN_NEW_VINTAGE_DAYS_TO_RETRAIN);
    expect(perPlant[1]).toBeLessThan(MIN_NEW_VINTAGE_DAYS_TO_RETRAIN);
    expect(shouldRetrain(perPlant)).toBe(true);
  });

  test("zero new data anywhere -> do not retrain", () => {
    expect(shouldRetrain([0, 0])).toBe(false);
  });

  test("a genuinely new third plant with zero vintage days yet does not block or dilute retraining eligibility for the others", () => {
    expect(shouldRetrain([MIN_NEW_VINTAGE_DAYS_TO_RETRAIN, 0])).toBe(true);
  });

  test("custom threshold override is respected", () => {
    expect(shouldRetrain([2], 2)).toBe(true);
    expect(shouldRetrain([1], 2)).toBe(false);
  });
});
