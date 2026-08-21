import { test, expect } from "@playwright/test";

import {
  computeGenuineVintageDays,
  selectBestShortTierRowPerInterval,
  shouldRetrain,
  MIN_NEW_VINTAGE_DAYS_TO_RETRAIN,
  MIN_QUALIFYING_SLOTS_PER_DAY,
  TARGET_D1_LEAD_MINUTES,
} from "@/lib/forecast/ml/genuine-vintage";
import { EXPECTED_PRODUCTION_INTERVALS_PER_DAY, isWithinIngestionWindow } from "@/lib/telemetry/ingestion-window";

/**
 * Continuous Retraining Loop + Genuine-Vintage Completeness Correction
 * milestones. Pure-function tests for the fixed TRUE_VINTAGE eligibility
 * definition (per-interval selection, AND the corrected 64-slot
 * ingestion-window denominator) and the conservative retraining
 * eligibility gate — no DB, no browser, no network (see
 * `forecast-bucket-aggregation.spec.ts`'s own top doc comment for why this
 * suite, not a dedicated unit-test runner, hosts these).
 *
 * Two bugs this suite guards against:
 *
 * 1. The OLD eligibility check counted every reconciled `PvForecastRecord`
 *    row for a calendar day and required exactly 96. In production, once
 *    the twice-daily refresh has run more than once against the same
 *    future day (the permanent, normal state), a day accumulates rows
 *    from MANY overlapping vintages — Atlanta's 2026-08-14 alone had 847
 *    rows from 10 distinct vintages. Fixed by `selectBestShortTierRowPerInterval`
 *    deduplicating per interval first.
 * 2. The 96-slot denominator itself was wrong: Voltessa's shared telemetry
 *    ingestion window is only 06:00-22:00 Europe/Sofia (64 of the day's 96
 *    fifteen-minute slots) - nighttime PV production is structurally zero
 *    and telemetry is intentionally never pulled for those hours. Applying
 *    the old threshold against a full day rejected a plant (Chomakovtsi)
 *    that was reaching ~95% of its own intentionally-ingested window.
 *    Fixed: the denominator is now derived from
 *    `lib/telemetry/ingestion-window.ts`'s `EXPECTED_PRODUCTION_INTERVALS_PER_DAY`
 *    (64), with the SAME 93.75% completeness ratio this project has
 *    always used, now correctly expressed as 60/64 instead of 90/96.
 */

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

function dayIntervalKeys(dayStart: Date): Date[] {
  return Array.from({ length: 96 }, (_, i) => new Date(dayStart.getTime() + i * FIFTEEN_MIN_MS));
}

/** Only the slots within the shared ingestion window (06:00-22:00 Sofia) - exactly 64 for any August date (no DST transition mid-month). */
function daytimeIntervalKeys(dayStart: Date): Date[] {
  return dayIntervalKeys(dayStart).filter((t) => isWithinIngestionWindow(t));
}

/** Only the slots OUTSIDE the shared ingestion window - intentionally never ingested in production. */
function nighttimeIntervalKeys(dayStart: Date): Date[] {
  return dayIntervalKeys(dayStart).filter((t) => !isWithinIngestionWindow(t));
}

test.describe("EXPECTED_PRODUCTION_INTERVALS_PER_DAY — the shared, centralized denominator", () => {
  test("is exactly 64 (06:00-22:00 Europe/Sofia = 16 hours = 64 fifteen-minute intervals)", () => {
    expect(EXPECTED_PRODUCTION_INTERVALS_PER_DAY).toBe(64);
  });

  test("MIN_QUALIFYING_SLOTS_PER_DAY preserves the project's original 93.75% completeness ratio against the corrected denominator", () => {
    expect(MIN_QUALIFYING_SLOTS_PER_DAY).toBe(60);
    expect(MIN_QUALIFYING_SLOTS_PER_DAY / EXPECTED_PRODUCTION_INTERVALS_PER_DAY).toBeCloseTo(90 / 96, 10);
  });

  test("a full August day has exactly 64 in-window slots and 32 intentionally-absent nighttime slots", () => {
    const dayStart = new Date("2026-08-14T00:00:00.000Z");
    expect(daytimeIntervalKeys(dayStart).length).toBe(64);
    expect(nighttimeIntervalKeys(dayStart).length).toBe(32);
  });
});

test.describe("selectBestShortTierRowPerInterval", () => {
  test("picks the row closest to a genuine 24h (D+1) lead time when multiple vintages cover the same interval", () => {
    const target = new Date("2026-08-14T13:30:00.000Z"); // daytime (13:30 UTC)
    const rows = [
      { targetIntervalStart: target, leadTimeMinutes: 60 }, // 1h lead - a same-day intraday correction
      { targetIntervalStart: target, leadTimeMinutes: TARGET_D1_LEAD_MINUTES - 10 }, // ~24h lead - the genuine D+1 candidate
      { targetIntervalStart: target, leadTimeMinutes: 47 * 60 }, // 47h lead - still SHORT tier, but far from D+1
    ];

    const result = selectBestShortTierRowPerInterval(rows);

    expect(result).toHaveLength(1);
    expect(result[0]!.leadTimeMinutes).toBe(TARGET_D1_LEAD_MINUTES - 10);
  });

  test("nighttime rows are excluded entirely, even if reconciled data somehow exists for them - never counted", () => {
    const nightTarget = new Date("2026-08-14T01:00:00.000Z"); // 01:00 UTC = 04:00 Sofia, well outside 06:00-22:00
    const rows = [{ targetIntervalStart: nightTarget, leadTimeMinutes: TARGET_D1_LEAD_MINUTES }];

    expect(selectBestShortTierRowPerInterval(rows)).toEqual([]);
  });

  test("regression: the real Atlanta 2026-08-14 shape (10 overlapping vintages for one day) collapses to at most 64 in-window rows, one per interval - never inflated", () => {
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

    expect(result.length).toBeLessThanOrEqual(64); // the corrected, ingestion-window-aware ceiling
    const distinctSlots = new Set(result.map((r) => r.targetIntervalStart.getTime()));
    expect(distinctSlots.size).toBe(result.length); // never two rows for the same interval
    expect(result.every((r) => isWithinIngestionWindow(r.targetIntervalStart))).toBe(true);
  });
});

test.describe("computeGenuineVintageDays — corrected 64-slot ingestion-window denominator", () => {
  test("a day with all 64 in-window slots covered (even by many overlapping vintages AND extra nighttime rows) qualifies exactly once - nighttime never inflates or changes the result", () => {
    const dayStart = new Date("2026-08-14T00:00:00.000Z");
    const daytimeRows = daytimeIntervalKeys(dayStart).flatMap((t) => [{ targetIntervalStart: t }, { targetIntervalStart: t }, { targetIntervalStart: t }]);
    const bonusNighttimeRows = nighttimeIntervalKeys(dayStart).slice(0, 10).map((t) => ({ targetIntervalStart: t })); // Atlanta-style incidental extra nighttime data

    const days = computeGenuineVintageDays([...daytimeRows, ...bonusNighttimeRows]);

    expect(days).toEqual(["2026-08-14"]);
  });

  test("Chomakovtsi-style coverage: 61/64 in-window slots, ZERO nighttime rows, qualifies - the exact real production shape confirmed for Chomakovtsi", () => {
    const dayStart = new Date("2026-08-11T00:00:00.000Z");
    const daytime = daytimeIntervalKeys(dayStart);
    expect(daytime.length).toBe(64);
    const rows = daytime.slice(0, 61).map((t) => ({ targetIntervalStart: t })); // 61/64, no nighttime at all

    const days = computeGenuineVintageDays(rows);

    expect(days).toEqual(["2026-08-11"]);
  });

  test("60/64 in-window slots qualifies (the threshold boundary is inclusive)", () => {
    const dayStart = new Date("2026-08-15T00:00:00.000Z");
    const rows = daytimeIntervalKeys(dayStart).slice(0, 60).map((t) => ({ targetIntervalStart: t }));

    expect(computeGenuineVintageDays(rows)).toEqual(["2026-08-15"]);
  });

  test("59/64 in-window slots does NOT qualify (one short of the threshold)", () => {
    const dayStart = new Date("2026-08-16T00:00:00.000Z");
    const rows = daytimeIntervalKeys(dayStart).slice(0, 59).map((t) => ({ targetIntervalStart: t }));

    expect(computeGenuineVintageDays(rows)).toEqual([]);
  });

  test("intentionally-omitted nighttime slots never count AGAINST completeness: 60 in-window rows qualify identically whether or not any nighttime rows are also present", () => {
    const dayStart = new Date("2026-08-17T00:00:00.000Z");
    const daytimeOnly = daytimeIntervalKeys(dayStart).slice(0, 60).map((t) => ({ targetIntervalStart: t }));
    const withNighttimeToo = [...daytimeOnly, ...nighttimeIntervalKeys(dayStart).map((t) => ({ targetIntervalStart: t }))];

    const resultDaytimeOnly = computeGenuineVintageDays(daytimeOnly);
    const resultWithNighttime = computeGenuineVintageDays(withNighttimeToo);

    expect(resultDaytimeOnly).toEqual(["2026-08-17"]);
    expect(resultWithNighttime).toEqual(["2026-08-17"]);
    expect(resultDaytimeOnly).toEqual(resultWithNighttime); // nighttime presence/absence changes nothing
  });

  test("intentionally-omitted nighttime slots never count FOR completeness either: 32 nighttime rows alone (zero daytime) never qualify a day, no matter how many exist", () => {
    const dayStart = new Date("2026-08-18T00:00:00.000Z");
    const nighttimeOnly = nighttimeIntervalKeys(dayStart).map((t) => ({ targetIntervalStart: t }));
    expect(nighttimeOnly.length).toBe(32);

    expect(computeGenuineVintageDays(nighttimeOnly)).toEqual([]);
  });

  test("both plants use the exact same eligibility logic - identical 60/64 threshold applied to two differently-shaped synthetic datasets (Atlanta-style: full daytime + nighttime bonus; Chomakovtsi-style: 61/64 daytime, no nighttime)", () => {
    const dayStart = new Date("2026-08-12T00:00:00.000Z");
    const atlantaStyleRows = [
      ...daytimeIntervalKeys(dayStart).map((t) => ({ targetIntervalStart: t })), // 64/64
      ...nighttimeIntervalKeys(dayStart).slice(0, 29).map((t) => ({ targetIntervalStart: t })), // incidental bonus
    ];
    const chomakovtsiStyleRows = daytimeIntervalKeys(dayStart).slice(0, 61).map((t) => ({ targetIntervalStart: t })); // 61/64, no nighttime

    // The SAME function, no plant parameter anywhere - both pass, by the same rule.
    expect(computeGenuineVintageDays(atlantaStyleRows)).toEqual(["2026-08-12"]);
    expect(computeGenuineVintageDays(chomakovtsiStyleRows)).toEqual(["2026-08-12"]);
  });

  test("multiple days are evaluated independently and returned sorted", () => {
    const day1 = new Date("2026-08-10T00:00:00.000Z");
    const day2 = new Date("2026-08-12T00:00:00.000Z");
    const day3 = new Date("2026-08-11T00:00:00.000Z"); // only 30 in-window slots - should not qualify

    const rows = [
      ...daytimeIntervalKeys(day1).map((t) => ({ targetIntervalStart: t })),
      ...daytimeIntervalKeys(day2).map((t) => ({ targetIntervalStart: t })),
      ...daytimeIntervalKeys(day3).slice(0, 30).map((t) => ({ targetIntervalStart: t })),
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
