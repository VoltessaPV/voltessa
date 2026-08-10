import { test, expect } from "@playwright/test";

import { buildDailyForecastBucketMap, computeForecastSummary } from "@/lib/forecast/forecast-bucket-aggregation";
import type { LatestForecastVintage, PersistedForecastInterval } from "@/lib/forecast/forecast-read";
import { localDayBoundsUtc, localMonthBoundsUtc, localWeekBoundsUtc } from "@/lib/market-price/timezone";

/**
 * Regression coverage for the Dashboard Week/Month Forecast Correction
 * milestone: two real bugs found while auditing why the Week/Month chart's
 * grey forecast line and the Forecast Card's own Weekly/Monthly numbers
 * disagreed.
 *
 * 1. `buildDailyForecastBucketMap` had no lower bound on `periodStart`, so
 *    browsing a future week/month could leak days from between "now" and
 *    that future period's own start into the chart.
 * 2. `computeForecastSummary`'s `weeklyForecastKwh` used a rolling
 *    "next 7 days from today" window instead of the toolbar's own ISO
 *    Mon-Sun week (`localWeekBoundsUtc`) - two different date ranges that
 *    could never reconcile with the Week chart's own daily buckets.
 *
 * Pure-function tests, no DB/browser/network - see
 * `forecast-weather-interpolation.spec.ts` for why this suite (not a
 * dedicated unit-test runner, which apps/web doesn't have) hosts these.
 */

const SOFIA = "Europe/Sofia";
const QUARTER_HOUR_KWH_PER_KW = 0.25;

function dailyIntervals(dayStart: Date, forecastKw: number): PersistedForecastInterval[] {
  const intervals: PersistedForecastInterval[] = [];
  for (let i = 0; i < 96; i += 1) {
    intervals.push({
      targetIntervalStart: new Date(dayStart.getTime() + i * 15 * 60 * 1000),
      forecastKw,
      forecastKwh: forecastKw * QUARTER_HOUR_KWH_PER_KW,
      horizonTier: "MEDIUM",
      confidence: "MEDIUM",
    });
  }
  return intervals;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Real Sofia local-day boundary containing `instant` - August has no DST transition, so `start + N * DAY_MS` stays local-day-aligned for every test below. */
function sofiaDayStart(instant: Date): Date {
  return localDayBoundsUtc(instant, SOFIA).start;
}

test.describe("buildDailyForecastBucketMap", () => {
  test("aggregates 15-minute forecastKwh into a per-day kWh total, not a sum of kW", () => {
    // 10 kW for 96 quarter-hours = 10 * 24 = 240 kWh for the day.
    const dayStart = sofiaDayStart(new Date("2026-08-12T09:00:00.000Z"));
    const intervals = dailyIntervals(dayStart, 10);
    const now = sofiaDayStart(new Date("2026-08-11T09:00:00.000Z")); // "today" is a different day
    const periodEnd = new Date(dayStart.getTime() + DAY_MS);

    const result = buildDailyForecastBucketMap(intervals, now, now, periodEnd, null);

    expect(result.size).toBe(1);
    expect(result.get(dayStart.getTime())).toBe(240);
  });

  test("never leaks a day before periodStart when browsing a future period", () => {
    // Vintage issued "now" spans this week AND a future week three weeks out.
    const now = sofiaDayStart(new Date("2026-08-10T06:00:00.000Z"));
    const nearIntervals = dailyIntervals(new Date(now.getTime() + DAY_MS), 5);
    const futureWeekStart = sofiaDayStart(new Date("2026-08-31T09:00:00.000Z"));
    const futureIntervals = dailyIntervals(futureWeekStart, 8);
    const periodEnd = new Date(futureWeekStart.getTime() + 7 * DAY_MS);

    const result = buildDailyForecastBucketMap(
      [...nearIntervals, ...futureIntervals],
      now,
      futureWeekStart,
      periodEnd,
      null,
    );

    // Only the future week's own day may appear - nothing from the nearer,
    // already-elapsed-relative-to-that-period days between `now` and
    // `futureWeekStart` should leak in.
    expect([...result.keys()]).toEqual([futureWeekStart.getTime()]);
  });

  test("today's bucket uses the full-day projected total, not the per-interval sum (no double count)", () => {
    const todayStart = sofiaDayStart(new Date("2026-08-12T10:00:00.000Z"));
    const now = new Date(todayStart.getTime() + 10 * 60 * 60 * 1000); // mid-morning, same local day
    const todayIntervals = dailyIntervals(todayStart, 20); // would sum to 480 if not special-cased
    const periodEnd = new Date(todayStart.getTime() + DAY_MS);

    const result = buildDailyForecastBucketMap(todayIntervals, now, todayStart, periodEnd, 123.45);

    expect(result.get(todayStart.getTime())).toBe(123.45);
  });
});

test.describe("computeForecastSummary reconciliation with the Week/Month chart's own daily buckets", () => {
  test("weeklyForecastKwh equals the sum of the Week chart's own 7 daily buckets", () => {
    const now = new Date("2026-08-10T09:00:00.000Z"); // Monday - start of its own ISO week
    const weekBounds = localWeekBoundsUtc(now, SOFIA);
    expect(weekBounds.start.getTime()).toBeLessThanOrEqual(now.getTime());

    // One vintage: today (partial, forecast only from `now` onward) plus 6
    // more full future days, each a distinct, easily-verified kW level.
    const intervals: PersistedForecastInterval[] = [];
    for (let day = 0; day < 10; day += 1) {
      const dayStart = new Date(weekBounds.start.getTime() + day * 24 * 60 * 60 * 1000);
      intervals.push(...dailyIntervals(dayStart, 10 + day));
    }

    const latestVintage: LatestForecastVintage = {
      issuedAt: now,
      modelVersion: "test",
      weatherSource: "test",
      intervals,
    };

    const summary = computeForecastSummary({
      now,
      latestVintage,
      todayActualSoFarKwh: 50, // today's actual production so far
      weekActualSoFarKwh: null, // today is the week's own Monday - nothing elapsed yet
      monthActualSoFarKwh: null,
    });

    const weekMap = buildDailyForecastBucketMap(
      intervals,
      now,
      weekBounds.start,
      weekBounds.end,
      summary.dailyForecastKwh,
    );

    expect(weekMap.size).toBe(7);
    const weekSum = [...weekMap.values()].reduce((sum, kwh) => sum + kwh, 0);
    expect(summary.weeklyForecastKwh).toBeCloseTo(weekSum, 2);
  });

  test("monthlyForecastKwh equals already-elapsed actual + the Month chart's own daily buckets", () => {
    const now = new Date("2026-08-10T09:00:00.000Z");
    const monthBounds = localMonthBoundsUtc(now, SOFIA);

    const intervals: PersistedForecastInterval[] = [];
    for (let day = 0; day < 25; day += 1) {
      const dayStart = new Date(monthBounds.start.getTime() + (9 + day) * 24 * 60 * 60 * 1000);
      if (dayStart.getTime() >= monthBounds.end.getTime()) break;
      intervals.push(...dailyIntervals(dayStart, 12));
    }

    const latestVintage: LatestForecastVintage = {
      issuedAt: now,
      modelVersion: "test",
      weatherSource: "test",
      intervals,
    };

    const monthActualSoFarKwh = 900; // Aug 1-9's real production

    const summary = computeForecastSummary({
      now,
      latestVintage,
      todayActualSoFarKwh: 50,
      weekActualSoFarKwh: null,
      monthActualSoFarKwh,
    });

    const monthMap = buildDailyForecastBucketMap(
      intervals,
      now,
      monthBounds.start,
      monthBounds.end,
      summary.dailyForecastKwh,
    );

    const monthChartSum = [...monthMap.values()].reduce((sum, kwh) => sum + kwh, 0);
    expect(summary.monthlyForecastKwh).toBeCloseTo(monthChartSum + monthActualSoFarKwh, 2);
  });
});
