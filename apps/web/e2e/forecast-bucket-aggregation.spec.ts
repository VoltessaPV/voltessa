import { test, expect } from "@playwright/test";

import { buildDailyForecastBucketMap, computeForecastSummary } from "@/lib/forecast/forecast-bucket-aggregation";
import type { LatestForecastVintage, PersistedForecastInterval } from "@/lib/forecast/forecast-read";
import { localDayBoundsUtc, localMonthBoundsUtc, localWeekBoundsUtc } from "@/lib/market-price/timezone";

/**
 * Forecast Semantics & Measurement Accuracy milestone. Regression coverage
 * for the deterministic, selected-date-driven forecast summary that
 * replaced the old real-"now"/actual-blended one (see
 * `forecast-bucket-aggregation.ts`'s own top doc comment for the full
 * rationale). Covers the exact test matrix requested for this milestone:
 *
 * A. Fixed daily forecast — same vintage + same selected date always
 *    produces the same `dailyForecastKwh`, regardless of what real "now" is.
 * B. No actual blending — `computeForecastSummary` doesn't even accept an
 *    actual-production input any more; there is nothing for it to blend.
 * C. Daily peak — `dailyPeakKw` is the max over the ENTIRE selected day,
 *    never just its "remaining" hours.
 * D. Date switching — two different selected dates against the same
 *    vintage produce independent, correctly-scoped results with no
 *    current-day leakage.
 * E. Week/Month follow the selected date's own week/month, not "today"'s
 *    or a rolling window.
 * G/H. A past/future selected date never falls back to real "now"'s values.
 *
 * Pure-function tests, no DB/browser/network - see
 * `forecast-weather-interpolation.spec.ts` for why this suite (not a
 * dedicated unit-test runner, which apps/web doesn't have) hosts these.
 */

const SOFIA = "Europe/Sofia";
const QUARTER_HOUR_KWH_PER_KW = 0.25;
const DAY_MS = 24 * 60 * 60 * 1000;

function dailyIntervals(dayStart: Date, forecastKw: number | ((bucketIndex: number) => number)): PersistedForecastInterval[] {
  const intervals: PersistedForecastInterval[] = [];
  for (let i = 0; i < 96; i += 1) {
    const kw = typeof forecastKw === "function" ? forecastKw(i) : forecastKw;
    intervals.push({
      targetIntervalStart: new Date(dayStart.getTime() + i * 15 * 60 * 1000),
      forecastKw: kw,
      forecastKwh: kw * QUARTER_HOUR_KWH_PER_KW,
      horizonTier: "MEDIUM",
      confidence: "MEDIUM",
    });
  }
  return intervals;
}

/** Real Sofia local-day boundary containing `instant` - August has no DST transition, so `start + N * DAY_MS` stays local-day-aligned for every test below. */
function sofiaDayStart(instant: Date): Date {
  return localDayBoundsUtc(instant, SOFIA).start;
}

function makeVintage(issuedAt: Date, intervals: PersistedForecastInterval[]): LatestForecastVintage {
  return { issuedAt, modelVersion: "test", weatherSource: "test", intervals };
}

test.describe("buildDailyForecastBucketMap", () => {
  test("aggregates 15-minute forecastKwh into a per-day kWh total, not a sum of kW", () => {
    // 10 kW for 96 quarter-hours = 10 * 24 = 240 kWh for the day.
    const dayStart = sofiaDayStart(new Date("2026-08-12T09:00:00.000Z"));
    const intervals = dailyIntervals(dayStart, 10);
    const periodEnd = new Date(dayStart.getTime() + DAY_MS);

    const result = buildDailyForecastBucketMap(intervals, dayStart, periodEnd);

    expect(result.size).toBe(1);
    expect(result.get(dayStart.getTime())).toBe(240);
  });

  test("never leaks a day before periodStart when browsing a future period", () => {
    const nearDayStart = sofiaDayStart(new Date("2026-08-11T06:00:00.000Z"));
    const nearIntervals = dailyIntervals(nearDayStart, 5);
    const futureWeekStart = sofiaDayStart(new Date("2026-08-31T09:00:00.000Z"));
    const futureIntervals = dailyIntervals(futureWeekStart, 8);
    const periodEnd = new Date(futureWeekStart.getTime() + 7 * DAY_MS);

    const result = buildDailyForecastBucketMap([...nearIntervals, ...futureIntervals], futureWeekStart, periodEnd);

    // Only the future week's own day may appear - nothing from the nearer
    // day before `periodStart` should leak in.
    expect([...result.keys()]).toEqual([futureWeekStart.getTime()]);
  });

  test("today's bucket is summed exactly like every other day now - no special-casing, no double count", () => {
    const todayStart = sofiaDayStart(new Date("2026-08-12T10:00:00.000Z"));
    const todayIntervals = dailyIntervals(todayStart, 20); // 20 kW * 24h = 480 kWh
    const periodEnd = new Date(todayStart.getTime() + DAY_MS);

    const result = buildDailyForecastBucketMap(todayIntervals, todayStart, periodEnd);

    expect(result.get(todayStart.getTime())).toBe(480);
  });
});

test.describe("computeForecastSummary — fixed, deterministic, selected-date-driven", () => {
  test("A. Fixed daily forecast: identical for the same vintage + selected date regardless of real now", () => {
    const dayStart = sofiaDayStart(new Date("2026-08-12T00:00:00.000Z"));
    const intervals = dailyIntervals(dayStart, 15); // 15 kW * 24h = 360 kWh
    const latestVintage = makeVintage(dayStart, intervals);

    const morningSelection = new Date(dayStart.getTime() + 2 * 60 * 60 * 1000);
    const eveningSelection = new Date(dayStart.getTime() + 20 * 60 * 60 * 1000);

    const morning = computeForecastSummary({ selectedDate: morningSelection, latestVintage });
    const evening = computeForecastSummary({ selectedDate: eveningSelection, latestVintage });

    // Both instants fall on the same Sofia calendar day, so both must
    // resolve to the identical full-day total - "now" (which instant within
    // the day we ask from) must never matter.
    expect(morning.dailyForecastKwh).toBe(360);
    expect(evening.dailyForecastKwh).toBe(360);
    expect(morning.dailyForecastKwh).toBe(evening.dailyForecastKwh);
  });

  test("B. No actual blending: computeForecastSummary has no actual-production input at all", () => {
    const dayStart = sofiaDayStart(new Date("2026-08-12T00:00:00.000Z"));
    const intervals = dailyIntervals(dayStart, 10); // 10 kW * 24h = 240 kWh
    const latestVintage = makeVintage(dayStart, intervals);

    // The function signature itself only accepts `selectedDate` and
    // `latestVintage` (see forecast-bucket-aggregation.ts) - there is no
    // parameter through which "actual production so far" could be passed,
    // so the only possible check here is that the result is the persisted
    // vintage's own full-day total, unconditionally.
    const summary = computeForecastSummary({ selectedDate: dayStart, latestVintage });
    expect(summary.dailyForecastKwh).toBe(240);
  });

  test("C. Daily peak is the max over the ENTIRE selected day, not just remaining hours", () => {
    const dayStart = sofiaDayStart(new Date("2026-08-12T00:00:00.000Z"));
    // Peak (50 kW) occurs early in the day (bucket 10, ~02:30) - a
    // "remaining hours only" computation evaluated from midday onward would
    // miss it entirely.
    const intervals = dailyIntervals(dayStart, (i) => (i === 10 ? 50 : 5));
    const latestVintage = makeVintage(dayStart, intervals);

    const middayInstant = new Date(dayStart.getTime() + 13 * 60 * 60 * 1000);
    const summary = computeForecastSummary({ selectedDate: middayInstant, latestVintage });

    expect(summary.dailyPeakKw).toBe(50);
  });

  test("D. Date switching: two different selected dates against the same vintage produce independent results", () => {
    const day1Start = sofiaDayStart(new Date("2026-08-12T00:00:00.000Z"));
    const day2Start = new Date(day1Start.getTime() + DAY_MS);
    const intervals = [...dailyIntervals(day1Start, 10), ...dailyIntervals(day2Start, 25)];
    const latestVintage = makeVintage(day1Start, intervals);

    const d1 = computeForecastSummary({ selectedDate: day1Start, latestVintage });
    const d2 = computeForecastSummary({ selectedDate: day2Start, latestVintage });

    expect(d1.dailyForecastKwh).toBe(240); // 10 kW * 24h
    expect(d2.dailyForecastKwh).toBe(600); // 25 kW * 24h
    expect(d1.dailyForecastKwh).not.toBe(d2.dailyForecastKwh);
    expect(d1.dailyPeakKw).toBe(10);
    expect(d2.dailyPeakKw).toBe(25);
  });

  test("E. Weekly/Monthly follow the SELECTED date's own week/month, not today's or a rolling window", () => {
    // Selected date is deliberately in a different ISO week AND a different
    // calendar month than "today" (real now, whatever it is when this test
    // runs) - the summary must still resolve to August's own week/month.
    const selected = new Date("2026-08-20T09:00:00.000Z"); // a Thursday
    const weekBounds = localWeekBoundsUtc(selected, SOFIA);
    const monthBounds = localMonthBoundsUtc(selected, SOFIA);

    // Data covers the entire calendar month (a strict superset of any week
    // inside it), so both assertions below are unambiguous.
    const intervals: PersistedForecastInterval[] = [];
    for (let t = monthBounds.start.getTime(); t < monthBounds.end.getTime(); t += DAY_MS) {
      intervals.push(...dailyIntervals(new Date(t), 10));
    }
    const latestVintage = makeVintage(monthBounds.start, intervals);

    const summary = computeForecastSummary({ selectedDate: selected, latestVintage });

    const weekDays = Math.round((weekBounds.end.getTime() - weekBounds.start.getTime()) / DAY_MS);
    const monthDays = Math.round((monthBounds.end.getTime() - monthBounds.start.getTime()) / DAY_MS);

    expect(summary.weeklyForecastKwh).toBeCloseTo(weekDays * 240, 2); // 10 kW * 24h per day
    expect(summary.monthlyForecastKwh).toBeCloseTo(monthDays * 240, 2);
  });

  test("G. A past selected date never falls back to current values - null when the vintage doesn't cover it", () => {
    // Vintage issued today only covers forward from its own issuance -
    // asking for a date well before that must come back empty, never
    // silently substitute today's own numbers.
    const issuedAt = new Date("2026-08-15T00:10:00.000Z");
    const intervals = dailyIntervals(issuedAt, 10);
    const latestVintage = makeVintage(issuedAt, intervals);

    const pastDate = new Date("2026-08-01T12:00:00.000Z");
    const summary = computeForecastSummary({ selectedDate: pastDate, latestVintage });

    expect(summary.dailyForecastKwh).toBeNull();
    expect(summary.dailyPeakKw).toBeNull();
  });

  test("H. A future selected date shows that future day's own forecast, not today's", () => {
    const todayStart = sofiaDayStart(new Date("2026-08-12T00:00:00.000Z"));
    const futureDayStart = new Date(todayStart.getTime() + 10 * DAY_MS);
    const intervals = [...dailyIntervals(todayStart, 10), ...dailyIntervals(futureDayStart, 30)];
    const latestVintage = makeVintage(todayStart, intervals);

    const futureSummary = computeForecastSummary({ selectedDate: futureDayStart, latestVintage });
    const todaySummary = computeForecastSummary({ selectedDate: todayStart, latestVintage });

    expect(futureSummary.dailyForecastKwh).toBe(720); // 30 kW * 24h
    expect(futureSummary.dailyForecastKwh).not.toBe(todaySummary.dailyForecastKwh);
  });
});
