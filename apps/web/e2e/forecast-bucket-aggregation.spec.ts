import { test, expect } from "@playwright/test";

import {
  buildDailyForecastBucketMap,
  computeForecastSummary,
  type ElapsedDayActual,
  type TodayActualInterval,
} from "@/lib/forecast/forecast-bucket-aggregation";
import type { LatestForecastVintage, PersistedForecastInterval } from "@/lib/forecast/forecast-read";
import { localDayBoundsUtc, localMonthBoundsUtc, localWeekBoundsUtc } from "@/lib/market-price/timezone";

/**
 * Forecast Semantics & Measurement Accuracy milestone, the Aug 2026 "Daily
 * forecast" full-day semantics fix, and the Aug 2026 Week/Month full-period
 * + chart-continuity fixes.
 *
 * Original design (still true for any NON-today selected date, and for any
 * day of a week/month that genuinely doesn't contain today): every figure
 * is a fixed, deterministic sum/max over the persisted vintage's own rows
 * for the SELECTED day/week/month, never blended with actual production,
 * never dependent on real "now" (see this file's own production-code top
 * doc comment for the original "why" — a prior design that blended actual
 * into a "remaining today" figure was removed because it silently re-fit
 * itself to actual production as the day went on, hiding forecast error
 * instead of exposing it).
 *
 * The full-day semantics fix (confirmed root cause): for TODAY
 * specifically, `latestVintage.intervals` only ever contains rows from
 * the vintage's own generation time forward (`pv-forecast-core.ts`'s
 * `forecastStart = ceilTo15Min(now)` at generation time) — so summing
 * "every persisted row for today" silently produced a *remaining-from-
 * generation-time* total, not a genuine full calendar day. Fixed by
 * combining real actual (midnight..now) with remaining forecast
 * (now..end-of-day) for today only.
 *
 * The full-period (Week/Month) fix (confirmed root cause, second defect):
 * the SAME "only rows from generation time forward" property also means a
 * persisted vintage never has rows for a day BEFORE its own generation
 * time — so any already-elapsed day of the selected week/month (not just
 * today) was silently absent from `weeklyForecastKwh`/`monthlyForecastKwh`
 * altogether. Confirmed directly against production data: Chomakovtsi's
 * live `weeklyForecastKwh` read 1,657 kWh while 3,013 kWh had already been
 * produced that same week. Fixed by extending the exact same
 * actual-substitution pattern to every already-elapsed day, not just
 * today (`priorDaysActual`).
 *
 * The chart-continuity fix (confirmed root cause, `buildDailyForecastBucketMap`):
 * today's bucket in the Week/Month chart used to be the SAME partial,
 * generation-time-forward raw sum described above, which lands close to
 * (but not equal to) the actual line's own partial "so far" point, then
 * jumps to tomorrow's genuine full-day forecast — visually reading as "the
 * forecast starts from actual, then jumps." Fixed by giving today's bucket
 * the same actual+remaining combination the Forecast card already uses.
 * Tomorrow's bucket (and every day after it) is, and remains, a plain
 * persisted-vintage sum — completely independent of today's actual level.
 *
 * Pure-function tests, no DB/browser/network - see
 * `forecast-weather-interpolation.spec.ts` for why this suite (not a
 * dedicated unit-test runner, which apps/web doesn't have) hosts these.
 */

const SOFIA = "Europe/Sofia";
const QUARTER_HOUR_KWH_PER_KW = 0.25;
const FIVE_MIN_KWH_PER_KW = 5 / 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;

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

/** Real reconstructed-Available-PV-shaped fixture on the native 5-minute grid, matching `reconstructAvailablePv`'s own resolution. */
function actualIntervals(start: Date, end: Date, availablePvKw: number | ((bucketIndex: number) => number)): TodayActualInterval[] {
  const intervals: TodayActualInterval[] = [];
  let i = 0;
  for (let t = start.getTime(); t < end.getTime(); t += FIVE_MIN_MS) {
    const kw = typeof availablePvKw === "function" ? availablePvKw(i) : availablePvKw;
    intervals.push({ intervalStart: new Date(t), availablePvKwh: kw * FIVE_MIN_KWH_PER_KW });
    i += 1;
  }
  return intervals;
}

/** One already-elapsed calendar day's real production — `dashboard-data.ts`'s own `PlantDailyKpi`-backed shape, minimally reproduced. */
function elapsedDay(localDate: Date, producedKwh: number | null): ElapsedDayActual {
  return { localDate, producedKwh };
}

/** Test-local re-derivation of `sumActualKwh` (not exported from the production module) - used only to build this suite's own expected-value cross-checks. */
function sumActualForTest(intervals: TodayActualInterval[]): number {
  return intervals.reduce((sum, interval) => sum + (interval.availablePvKwh ?? 0), 0);
}

/** Real Sofia local-day boundary containing `instant` - August has no DST transition, so `start + N * DAY_MS` stays local-day-aligned for every test below. */
function sofiaDayStart(instant: Date): Date {
  return localDayBoundsUtc(instant, SOFIA).start;
}

function makeVintage(issuedAt: Date, intervals: PersistedForecastInterval[]): LatestForecastVintage {
  return { issuedAt, modelVersion: "test", weatherSource: "test", intervals };
}

/** A `now` far outside any date these tests construct - guarantees "today" never accidentally coincides with a test's own synthetic date, for the tests that specifically verify NON-today (now-independent) behavior. */
const UNRELATED_NOW = new Date("2030-01-01T12:00:00.000Z");

test.describe("buildDailyForecastBucketMap — non-today days remain a plain persisted-vintage sum", () => {
  test("aggregates 15-minute forecastKwh into a per-day kWh total, not a sum of kW", () => {
    // 10 kW for 96 quarter-hours = 10 * 24 = 240 kWh for the day.
    const dayStart = sofiaDayStart(new Date("2026-08-12T09:00:00.000Z"));
    const intervals = dailyIntervals(dayStart, 10);
    const periodEnd = new Date(dayStart.getTime() + DAY_MS);

    const result = buildDailyForecastBucketMap(intervals, dayStart, periodEnd, UNRELATED_NOW, []);

    expect(result.size).toBe(1);
    expect(result.get(dayStart.getTime())).toBe(240);
  });

  test("never leaks a day before periodStart when browsing a future period", () => {
    const nearDayStart = sofiaDayStart(new Date("2026-08-11T06:00:00.000Z"));
    const nearIntervals = dailyIntervals(nearDayStart, 5);
    const futureWeekStart = sofiaDayStart(new Date("2026-08-31T09:00:00.000Z"));
    const futureIntervals = dailyIntervals(futureWeekStart, 8);
    const periodEnd = new Date(futureWeekStart.getTime() + 7 * DAY_MS);

    const result = buildDailyForecastBucketMap(
      [...nearIntervals, ...futureIntervals],
      futureWeekStart,
      periodEnd,
      UNRELATED_NOW,
      [],
    );

    // Only the future week's own day may appear - nothing from the nearer
    // day before `periodStart` should leak in.
    expect([...result.keys()]).toEqual([futureWeekStart.getTime()]);
  });

  test("a non-today day's bucket is a plain persisted-vintage sum, unaffected by today-correction", () => {
    const dayStart = sofiaDayStart(new Date("2026-08-12T10:00:00.000Z"));
    const dayIntervalsFixture = dailyIntervals(dayStart, 20); // 20 kW * 24h = 480 kWh
    const periodEnd = new Date(dayStart.getTime() + DAY_MS);

    // `now` (UNRELATED_NOW) is nowhere near `dayStart` - this day is never "today".
    const result = buildDailyForecastBucketMap(dayIntervalsFixture, dayStart, periodEnd, UNRELATED_NOW, []);

    expect(result.get(dayStart.getTime())).toBe(480);
  });
});

test.describe("buildDailyForecastBucketMap — TODAY's bucket combines actual-so-far + remaining forecast", () => {
  test("today's bucket equals actual(midnight..now) + remaining-forecast(now..end-of-day), matching a partial (generation-time-forward-only) vintage", () => {
    const todayStart = sofiaDayStart(new Date("2026-08-21T00:00:00.000Z"));
    const now = new Date(todayStart.getTime() + 12 * 60 * 60 * 1000); // midday
    // Realistic production shape: vintage only has rows from generation
    // time (= now, here) forward - exactly like the real twice-daily
    // scheduler's own vintages.
    const allDayIntervals = dailyIntervals(todayStart, 10); // flat 10 kW forecast
    const partialVintageIntervals = allDayIntervals.filter((iv) => iv.targetIntervalStart.getTime() >= now.getTime());
    const latestVintage = makeVintage(now, partialVintageIntervals);
    const periodEnd = new Date(todayStart.getTime() + DAY_MS);

    const actual = actualIntervals(todayStart, now, 25); // 25 kW for 12h = 300 kWh actual, ran hotter than the 10 kW forecast

    const result = buildDailyForecastBucketMap(latestVintage.intervals, todayStart, periodEnd, now, actual);

    // Remaining forecast: 12h * 10 kW = 120 kWh. Actual: 300 kWh. Total: 420 kWh -
    // NOT the raw partial-vintage sum (120 kWh), which is what this bucket
    // would have been before this fix.
    expect(result.get(todayStart.getTime())).toBe(420);
  });

  test("today's bucket agrees exactly with the Forecast card's own dailyForecastKwh for identical inputs - one calculation, two consumers", () => {
    const todayStart = sofiaDayStart(new Date("2026-08-21T00:00:00.000Z"));
    const now = new Date(todayStart.getTime() + 17 * 60 * 60 * 1000); // late afternoon
    const allDayIntervals = dailyIntervals(todayStart, 15);
    const partialVintageIntervals = allDayIntervals.filter((iv) => iv.targetIntervalStart.getTime() >= now.getTime());
    const latestVintage = makeVintage(now, partialVintageIntervals);
    const periodEnd = new Date(todayStart.getTime() + DAY_MS);
    const actual = actualIntervals(todayStart, now, 18);

    const chartBucket = buildDailyForecastBucketMap(latestVintage.intervals, todayStart, periodEnd, now, actual);
    const cardSummary = computeForecastSummary({ selectedDate: now, latestVintage, now, todayActualIntervals: actual, priorDaysActual: [] });

    expect(chartBucket.get(todayStart.getTime())).toBe(cardSummary.dailyForecastKwh);
  });

  test("today's bucket appears even when the vintage has zero forecast rows for today, as long as actual data exists (stale/missing refresh)", () => {
    const todayStart = sofiaDayStart(new Date("2026-08-21T00:00:00.000Z"));
    const now = new Date(todayStart.getTime() + 10 * 60 * 60 * 1000);
    const periodEnd = new Date(todayStart.getTime() + DAY_MS);
    const actual = actualIntervals(todayStart, now, 12); // 10h * 12kW = 120 kWh

    const result = buildDailyForecastBucketMap([], todayStart, periodEnd, now, actual);

    expect(result.get(todayStart.getTime())).toBe(120);
  });

  test("today's bucket is omitted (not a fabricated zero) when there is neither forecast nor actual data for today", () => {
    const todayStart = sofiaDayStart(new Date("2026-08-21T00:00:00.000Z"));
    const now = new Date(todayStart.getTime() + 10 * 60 * 60 * 1000);
    const periodEnd = new Date(todayStart.getTime() + DAY_MS);

    const result = buildDailyForecastBucketMap([], todayStart, periodEnd, now, []);

    expect(result.has(todayStart.getTime())).toBe(false);
  });
});

test.describe("buildDailyForecastBucketMap — chart continuity regression: tomorrow is independent of today's actual level", () => {
  test("tomorrow's bucket is identical regardless of whether today's actual production is very low or very high", () => {
    const todayStart = sofiaDayStart(new Date("2026-08-21T00:00:00.000Z"));
    const now = new Date(todayStart.getTime() + 16 * 60 * 60 * 1000); // afternoon - today already mostly elapsed
    const tomorrowStart = new Date(todayStart.getTime() + DAY_MS);
    const periodEnd = new Date(tomorrowStart.getTime() + DAY_MS);

    // Tomorrow's forecast (flat 30 kW, full day) is IDENTICAL in both scenarios.
    const tomorrowIntervals = dailyIntervals(tomorrowStart, 30);
    const todayRemainingIntervals = dailyIntervals(todayStart, 10).filter((iv) => iv.targetIntervalStart.getTime() >= now.getTime());
    const intervals = [...todayRemainingIntervals, ...tomorrowIntervals];

    // Scenario A: today's actual production collapsed in the afternoon (a real, low endpoint).
    const lowActual = actualIntervals(todayStart, now, 2);
    // Scenario B: today's actual production stayed strong all day.
    const highActual = actualIntervals(todayStart, now, 40);

    const resultLow = buildDailyForecastBucketMap(intervals, todayStart, periodEnd, now, lowActual);
    const resultHigh = buildDailyForecastBucketMap(intervals, todayStart, periodEnd, now, highActual);

    // Today's own bucket DOES differ (it's supposed to - it reflects real actual production).
    expect(resultLow.get(todayStart.getTime())).not.toBe(resultHigh.get(todayStart.getTime()));

    // Tomorrow's bucket must be EXACTLY the same in both scenarios - 30 kW * 24h = 720 kWh,
    // completely unaffected by today's incomplete/low actual endpoint. This is the specific
    // bug this fix prevents: a low current-day actual must never drag tomorrow's forecast down.
    expect(resultLow.get(tomorrowStart.getTime())).toBe(720);
    expect(resultHigh.get(tomorrowStart.getTime())).toBe(720);
    expect(resultLow.get(tomorrowStart.getTime())).toBe(resultHigh.get(tomorrowStart.getTime()));
  });

  test("today's bucket and tomorrow's bucket are comparable in magnitude - no artificial cliff between them for an ordinary day", () => {
    const todayStart = sofiaDayStart(new Date("2026-08-21T00:00:00.000Z"));
    const now = new Date(todayStart.getTime() + 12 * 60 * 60 * 1000 + 15 * 60 * 1000); // just after a 12:10 refresh
    const tomorrowStart = new Date(todayStart.getTime() + DAY_MS);
    const periodEnd = new Date(tomorrowStart.getTime() + DAY_MS);

    // Same flat 10 kW forecast rate all around, and actual tracking the forecast closely -
    // an "ordinary," unremarkable day. Today's vintage rows only exist from generation time
    // (= now) forward, exactly like a real intraday refresh.
    const todayAll = dailyIntervals(todayStart, 10);
    const todayRemaining = todayAll.filter((iv) => iv.targetIntervalStart.getTime() >= now.getTime());
    const tomorrowIntervals = dailyIntervals(tomorrowStart, 10);
    const actual = actualIntervals(todayStart, now, 10); // matches the forecast rate

    const result = buildDailyForecastBucketMap([...todayRemaining, ...tomorrowIntervals], todayStart, periodEnd, now, actual);

    // Both should land close to the same full-day magnitude (240 kWh) - not today's bucket
    // artificially truncated to ~half that (which is what the raw partial-vintage sum used to produce).
    expect(result.get(todayStart.getTime())).toBeCloseTo(240, 1);
    expect(result.get(tomorrowStart.getTime())).toBe(240);
  });
});

test.describe("computeForecastSummary — non-today dates remain fixed, deterministic, now-independent", () => {
  test("A. Fixed daily forecast: identical for the same vintage + selected (non-today) date regardless of what instant within that day is asked, and regardless of real now", () => {
    const dayStart = sofiaDayStart(new Date("2026-08-12T00:00:00.000Z"));
    const intervals = dailyIntervals(dayStart, 15); // 15 kW * 24h = 360 kWh
    const latestVintage = makeVintage(dayStart, intervals);

    const morningSelection = new Date(dayStart.getTime() + 2 * 60 * 60 * 1000);
    const eveningSelection = new Date(dayStart.getTime() + 20 * 60 * 60 * 1000);

    // now = UNRELATED_NOW, so this day is never "today" for either call.
    const morning = computeForecastSummary({ selectedDate: morningSelection, latestVintage, now: UNRELATED_NOW, todayActualIntervals: [], priorDaysActual: [] });
    const evening = computeForecastSummary({ selectedDate: eveningSelection, latestVintage, now: UNRELATED_NOW, todayActualIntervals: [], priorDaysActual: [] });

    expect(morning.dailyForecastKwh).toBe(360);
    expect(evening.dailyForecastKwh).toBe(360);
    expect(morning.dailyForecastKwh).toBe(evening.dailyForecastKwh);
  });

  test("B. A non-today date's result is completely unaffected by todayActualIntervals - no silent blending outside the today case", () => {
    const dayStart = sofiaDayStart(new Date("2026-08-12T00:00:00.000Z"));
    const intervals = dailyIntervals(dayStart, 10); // 10 kW * 24h = 240 kWh
    const latestVintage = makeVintage(dayStart, intervals);

    // Even a huge, clearly-wrong-if-applied actual figure must have zero
    // effect when selectedDate isn't real "today".
    const bogusActual = actualIntervals(dayStart, new Date(dayStart.getTime() + DAY_MS), 999);

    const withoutActual = computeForecastSummary({ selectedDate: dayStart, latestVintage, now: UNRELATED_NOW, todayActualIntervals: [], priorDaysActual: [] });
    const withBogusActual = computeForecastSummary({ selectedDate: dayStart, latestVintage, now: UNRELATED_NOW, todayActualIntervals: bogusActual, priorDaysActual: [] });

    expect(withoutActual.dailyForecastKwh).toBe(240);
    expect(withBogusActual.dailyForecastKwh).toBe(240);
  });

  test("C. Daily peak is the max over the ENTIRE selected (non-today) day, not just remaining hours", () => {
    const dayStart = sofiaDayStart(new Date("2026-08-12T00:00:00.000Z"));
    // Peak (50 kW) occurs early in the day (bucket 10, ~02:30) - a
    // "remaining hours only" computation evaluated from midday onward would
    // miss it entirely.
    const intervals = dailyIntervals(dayStart, (i) => (i === 10 ? 50 : 5));
    const latestVintage = makeVintage(dayStart, intervals);

    const middayInstant = new Date(dayStart.getTime() + 13 * 60 * 60 * 1000);
    const summary = computeForecastSummary({ selectedDate: middayInstant, latestVintage, now: UNRELATED_NOW, todayActualIntervals: [], priorDaysActual: [] });

    expect(summary.dailyPeakKw).toBe(50);
  });

  test("D. Date switching: two different non-today selected dates against the same vintage produce independent results", () => {
    const day1Start = sofiaDayStart(new Date("2026-08-12T00:00:00.000Z"));
    const day2Start = new Date(day1Start.getTime() + DAY_MS);
    const intervals = [...dailyIntervals(day1Start, 10), ...dailyIntervals(day2Start, 25)];
    const latestVintage = makeVintage(day1Start, intervals);

    const d1 = computeForecastSummary({ selectedDate: day1Start, latestVintage, now: UNRELATED_NOW, todayActualIntervals: [], priorDaysActual: [] });
    const d2 = computeForecastSummary({ selectedDate: day2Start, latestVintage, now: UNRELATED_NOW, todayActualIntervals: [], priorDaysActual: [] });

    expect(d1.dailyForecastKwh).toBe(240); // 10 kW * 24h
    expect(d2.dailyForecastKwh).toBe(600); // 25 kW * 24h
    expect(d1.dailyForecastKwh).not.toBe(d2.dailyForecastKwh);
    expect(d1.dailyPeakKw).toBe(10);
    expect(d2.dailyPeakKw).toBe(25);
  });

  test("E. Weekly/Monthly follow the SELECTED date's own week/month, not today's or a rolling window", () => {
    const selected = new Date("2026-08-20T09:00:00.000Z"); // a Thursday
    const weekBounds = localWeekBoundsUtc(selected, SOFIA);
    const monthBounds = localMonthBoundsUtc(selected, SOFIA);

    const intervals: PersistedForecastInterval[] = [];
    for (let t = monthBounds.start.getTime(); t < monthBounds.end.getTime(); t += DAY_MS) {
      intervals.push(...dailyIntervals(new Date(t), 10));
    }
    const latestVintage = makeVintage(monthBounds.start, intervals);

    // now is deliberately outside this month entirely - "today" never
    // coincides with any day in this test's own range.
    const summary = computeForecastSummary({ selectedDate: selected, latestVintage, now: UNRELATED_NOW, todayActualIntervals: [], priorDaysActual: [] });

    const weekDays = Math.round((weekBounds.end.getTime() - weekBounds.start.getTime()) / DAY_MS);
    const monthDays = Math.round((monthBounds.end.getTime() - monthBounds.start.getTime()) / DAY_MS);

    expect(summary.weeklyForecastKwh).toBeCloseTo(weekDays * 240, 2); // 10 kW * 24h per day
    expect(summary.monthlyForecastKwh).toBeCloseTo(monthDays * 240, 2);
  });

  test("G. A past selected date never falls back to current values - null when the vintage doesn't cover it (historical completed day, unaffected by this fix)", () => {
    const issuedAt = new Date("2026-08-15T00:10:00.000Z");
    const intervals = dailyIntervals(issuedAt, 10);
    const latestVintage = makeVintage(issuedAt, intervals);

    const pastDate = new Date("2026-08-01T12:00:00.000Z");
    // now is set to real-ish "current" time, well after pastDate - pastDate
    // is never "today" here, so it must stay null exactly as before this fix.
    const summary = computeForecastSummary({ selectedDate: pastDate, latestVintage, now: new Date("2026-08-16T00:00:00.000Z"), todayActualIntervals: [], priorDaysActual: [] });

    expect(summary.dailyForecastKwh).toBeNull();
    expect(summary.dailyPeakKw).toBeNull();
  });

  test("H. A future selected date shows that future day's own forecast, not today's, and ignores todayActualIntervals entirely", () => {
    const todayStart = sofiaDayStart(new Date("2026-08-12T00:00:00.000Z"));
    const futureDayStart = new Date(todayStart.getTime() + 10 * DAY_MS);
    const intervals = [...dailyIntervals(todayStart, 10), ...dailyIntervals(futureDayStart, 30)];
    const latestVintage = makeVintage(todayStart, intervals);

    const now = new Date(todayStart.getTime() + 6 * 60 * 60 * 1000); // real "today" is todayStart's day
    const someActual = actualIntervals(todayStart, now, 5);

    const futureSummary = computeForecastSummary({ selectedDate: futureDayStart, latestVintage, now, todayActualIntervals: someActual, priorDaysActual: [] });

    expect(futureSummary.dailyForecastKwh).toBe(720); // 30 kW * 24h, untouched by todayActualIntervals
  });

  test("future day (10 days out) is a plain full-day persisted sum - unaffected by this fix", () => {
    const todayStart = sofiaDayStart(new Date("2026-08-12T00:00:00.000Z"));
    const futureDayStart = new Date(todayStart.getTime() + 10 * DAY_MS);
    const intervals = dailyIntervals(futureDayStart, 12);
    const latestVintage = makeVintage(todayStart, intervals);

    const now = new Date(todayStart.getTime() + 6 * 60 * 60 * 1000);
    const summary = computeForecastSummary({ selectedDate: futureDayStart, latestVintage, now, todayActualIntervals: [], priorDaysActual: [] });

    expect(summary.dailyForecastKwh).toBe(12 * 24);
    expect(summary.dailyPeakKw).toBe(12);
  });
});

test.describe("computeForecastSummary — TODAY: full-day = actual(midnight..now) + remaining forecast(now..end of day)", () => {
  test("current day, early morning (now near midnight): minimal actual, most of the day is remaining forecast", () => {
    const todayStart = sofiaDayStart(new Date("2026-08-12T00:00:00.000Z"));
    const now = new Date(todayStart.getTime() + 15 * 60 * 1000); // 00:15 Sofia
    // Vintage "generated" at exactly todayStart (00:00) - full day of rows present, matching a just-after-the-00:10-run vintage.
    const intervals = dailyIntervals(todayStart, 10); // 10 kW * 24h = 240 kWh
    const latestVintage = makeVintage(todayStart, intervals);
    // 15 minutes of real actual production at a lower rate than the forecast (typical near-zero pre-dawn).
    const actual = actualIntervals(todayStart, now, 2); // 2 kW * 0.25h = 0.5 kWh

    const summary = computeForecastSummary({ selectedDate: now, latestVintage, now, todayActualIntervals: actual, priorDaysActual: [] });

    // Remaining forecast: rows from 00:15 onward = 95 * 0.25 * 10 = 237.5 kWh. Actual: 0.5 kWh. Total 238.
    expect(summary.dailyForecastKwh).toBeCloseTo(238, 1);
  });

  test("current day, midday: actual so far + remaining forecast combine correctly", () => {
    const todayStart = sofiaDayStart(new Date("2026-08-12T00:00:00.000Z"));
    const now = new Date(todayStart.getTime() + 12 * 60 * 60 * 1000); // 12:00 Sofia
    const intervals = dailyIntervals(todayStart, 20); // flat 20 kW forecast all day
    const latestVintage = makeVintage(todayStart, intervals);
    // Real actual ran a bit hot vs. the forecast for the elapsed half of the day.
    const actual = actualIntervals(todayStart, now, 25); // 25 kW for 12h = 300 kWh actual

    const summary = computeForecastSummary({ selectedDate: now, latestVintage, now, todayActualIntervals: actual, priorDaysActual: [] });

    // Remaining forecast: 48 quarter-hours (12h) * 20 kW * 0.25 = 240 kWh. Actual: 300 kWh. Total 540.
    expect(summary.dailyForecastKwh).toBeCloseTo(540, 1);
  });

  test("current day, late afternoon: most of the day is realized actual, forecast covers only the remaining hours", () => {
    const todayStart = sofiaDayStart(new Date("2026-08-12T00:00:00.000Z"));
    const now = new Date(todayStart.getTime() + 17 * 60 * 60 * 1000); // 17:00 Sofia
    const intervals = dailyIntervals(todayStart, 15);
    const latestVintage = makeVintage(todayStart, intervals);
    const actual = actualIntervals(todayStart, now, 18); // 18 kW for 17h = 306 kWh actual

    const summary = computeForecastSummary({ selectedDate: now, latestVintage, now, todayActualIntervals: actual, priorDaysActual: [] });

    // Remaining forecast: 7h (28 quarter-hours) * 15 kW * 0.25 = 105 kWh. Actual 306. Total 411.
    expect(summary.dailyForecastKwh).toBeCloseTo(411, 1);
  });

  test("current day, near sunset (23:45): forecast has essentially nothing left, total is almost entirely realized actual", () => {
    const todayStart = sofiaDayStart(new Date("2026-08-12T00:00:00.000Z"));
    const now = new Date(todayStart.getTime() + 23 * 60 * 60 * 1000 + 45 * 60 * 1000); // 23:45 Sofia
    const intervals = dailyIntervals(todayStart, 10);
    const latestVintage = makeVintage(todayStart, intervals);
    const actual = actualIntervals(todayStart, now, 12); // 12 kW for 23.75h ≈ 285 kWh actual

    const summary = computeForecastSummary({ selectedDate: now, latestVintage, now, todayActualIntervals: actual, priorDaysActual: [] });

    // Only the final 15-minute row (23:45) remains: 10 kW * 0.25 = 2.5 kWh. Actual ≈ 285. Total ≈ 287.5.
    expect(summary.dailyForecastKwh).toBeCloseTo(287.5, 1);
  });

  test("no double counting: a forecast row exactly AT now is counted once, as remaining - never also folded into actual", () => {
    const todayStart = sofiaDayStart(new Date("2026-08-12T00:00:00.000Z"));
    const now = new Date(todayStart.getTime() + 6 * 60 * 60 * 1000); // exactly 06:00 Sofia - a real forecast row boundary
    const intervals = dailyIntervals(todayStart, 10); // flat 10 kW
    const latestVintage = makeVintage(todayStart, intervals);
    // Actual covers exactly [00:00, 06:00) - does NOT include the 06:00 row itself.
    const actual = actualIntervals(todayStart, now, 8); // 8 kW * 6h = 48 kWh

    const summary = computeForecastSummary({ selectedDate: now, latestVintage, now, todayActualIntervals: actual, priorDaysActual: [] });

    // Remaining forecast rows: [06:00, 24:00) = 72 quarter-hours * 10 kW * 0.25 = 180 kWh.
    // Actual: 48 kWh. Total: 228 kWh - the 06:00 row must appear in exactly one side of the sum.
    expect(summary.dailyForecastKwh).toBeCloseTo(228, 1);
  });

  test("midnight boundary: now = exactly local midnight - actual is empty, remaining is the full day", () => {
    const todayStart = sofiaDayStart(new Date("2026-08-12T00:00:00.000Z"));
    const now = todayStart; // exactly 00:00 Sofia
    const intervals = dailyIntervals(todayStart, 10); // 240 kWh full day
    const latestVintage = makeVintage(todayStart, intervals);

    const summary = computeForecastSummary({ selectedDate: now, latestVintage, now, todayActualIntervals: [], priorDaysActual: [] });

    expect(summary.dailyForecastKwh).toBe(240);
  });

  test("timezone/day-boundary: now expressed near the UTC/Sofia day boundary resolves 'today' in Sofia-local terms, not UTC", () => {
    // 2026-08-12T21:30:00Z is 2026-08-13T00:30 Sofia (UTC+3) - the NEW Sofia
    // calendar day, even though the UTC calendar date is still the 12th.
    const now = new Date("2026-08-12T21:30:00.000Z");
    const sofiaTodayStart = sofiaDayStart(now); // must resolve to Aug 13 Sofia midnight
    expect(sofiaTodayStart.toISOString()).toBe("2026-08-12T21:00:00.000Z"); // Aug 13 00:00 Sofia == Aug 12 21:00 UTC

    const intervals = dailyIntervals(sofiaTodayStart, 10);
    const latestVintage = makeVintage(sofiaTodayStart, intervals);
    const actual = actualIntervals(sofiaTodayStart, now, 3); // 30 minutes of actual

    const summary = computeForecastSummary({ selectedDate: now, latestVintage, now, todayActualIntervals: actual, priorDaysActual: [] });

    // now = 00:30 Sofia falls exactly on the 3rd 15-min row (00:00, 00:15,
    // 00:30) - remaining is [00:30, 24:00) = 94 quarter-hours * 10 * 0.25 =
    // 235 kWh. Actual: 30 min * 3 kW = 1.5 kWh. Total 236.5.
    expect(summary.dailyForecastKwh).toBeCloseTo(236.5, 1);
  });

  test("monotonicity: as now advances through the day with actual tracking the forecast closely, the full-day total stays stable rather than dropping", () => {
    const todayStart = sofiaDayStart(new Date("2026-08-12T00:00:00.000Z"));
    const intervals = dailyIntervals(todayStart, 10); // flat 10 kW all day, 240 kWh total
    const latestVintage = makeVintage(todayStart, intervals);

    const checkpoints = [4, 8, 12, 16, 20].map((h) => new Date(todayStart.getTime() + h * 60 * 60 * 1000));
    const totals = checkpoints.map((now) => {
      // Actual exactly matches the forecast's own rate for the elapsed portion - a "perfectly on-forecast" day.
      const actual = actualIntervals(todayStart, now, 10);
      return computeForecastSummary({ selectedDate: now, latestVintage, now, todayActualIntervals: actual, priorDaysActual: [] }).dailyForecastKwh;
    });

    for (const total of totals) {
      expect(total).toBeCloseTo(240, 1);
    }
  });

  test("daily peak combines the max of actual-so-far and the remaining forecast, whichever is higher", () => {
    const todayStart = sofiaDayStart(new Date("2026-08-12T00:00:00.000Z"));
    const now = new Date(todayStart.getTime() + 12 * 60 * 60 * 1000); // midday
    // Forecast peak (in the remaining/afternoon half) is 15 kW.
    const intervals = dailyIntervals(todayStart, (i) => (i >= 48 && i < 52 ? 15 : 5));
    const latestVintage = makeVintage(todayStart, intervals);
    // Real morning actual peaked higher (25 kW) than anything left in the forecast.
    const actual = actualIntervals(todayStart, now, (i) => (i === 60 ? 25 : 5));

    const summary = computeForecastSummary({ selectedDate: now, latestVintage, now, todayActualIntervals: actual, priorDaysActual: [] });

    expect(summary.dailyPeakKw).toBeCloseTo(25, 6);
  });

  test("today with zero remaining forecast rows and zero actual intervals returns null, never a fabricated zero", () => {
    const todayStart = sofiaDayStart(new Date("2026-08-12T00:00:00.000Z"));
    const now = todayStart;
    const latestVintage = makeVintage(todayStart, []); // no persisted rows at all for today
    const summary = computeForecastSummary({ selectedDate: now, latestVintage, now, todayActualIntervals: [], priorDaysActual: [] });

    expect(summary.dailyForecastKwh).toBeNull();
    expect(summary.dailyPeakKw).toBeNull();
  });

  test("weekly/monthly totals correctly include today's actual+remaining combination, not just today's truncated persisted rows", () => {
    const selected = new Date("2026-08-12T12:00:00.000Z"); // also "now"
    const weekBounds = localWeekBoundsUtc(selected, SOFIA);
    const now = new Date(sofiaDayStart(selected).getTime() + 12 * 60 * 60 * 1000); // midday today

    const intervals: PersistedForecastInterval[] = [];
    for (let t = weekBounds.start.getTime(); t < weekBounds.end.getTime(); t += DAY_MS) {
      // Today's OWN persisted rows only exist from generation time (now) onward - every other day in the week gets a full day.
      const day = new Date(t);
      if (day.getTime() === sofiaDayStart(selected).getTime()) {
        const full = dailyIntervals(day, 10);
        intervals.push(...full.filter((iv) => iv.targetIntervalStart.getTime() >= now.getTime()));
      } else {
        intervals.push(...dailyIntervals(day, 10));
      }
    }
    const latestVintage = makeVintage(now, intervals);
    const todayActual = actualIntervals(sofiaDayStart(selected), now, 10); // matches the forecast rate exactly: 12h * 10kW = 120 kWh

    const summary = computeForecastSummary({ selectedDate: selected, latestVintage, now, todayActualIntervals: todayActual, priorDaysActual: [] });

    const weekDays = Math.round((weekBounds.end.getTime() - weekBounds.start.getTime()) / DAY_MS);
    // Every day (including today, once corrected) contributes 240 kWh (10kW * 24h).
    expect(summary.weeklyForecastKwh).toBeCloseTo(weekDays * 240, 1);
  });

  test("date switching: selecting today then a different day (same vintage, same now) never leaks today's actual-blended values onto the other date, or vice versa", () => {
    const todayStart = sofiaDayStart(new Date("2026-08-12T00:00:00.000Z"));
    const otherDayStart = new Date(todayStart.getTime() - 3 * DAY_MS); // a past day, same vintage's horizon
    const now = new Date(todayStart.getTime() + 12 * 60 * 60 * 1000); // midday today

    const intervals = [...dailyIntervals(otherDayStart, 8), ...dailyIntervals(todayStart, 10)];
    const latestVintage = makeVintage(todayStart, intervals);
    const todayActual = actualIntervals(todayStart, now, 25); // actual ran hot vs. the 10 kW forecast

    // Simulates the Dashboard: user is viewing today, then switches the date picker to a past day, then back.
    const todaySummary1 = computeForecastSummary({ selectedDate: now, latestVintage, now, todayActualIntervals: todayActual, priorDaysActual: [] });
    const otherSummary = computeForecastSummary({ selectedDate: otherDayStart, latestVintage, now, todayActualIntervals: todayActual, priorDaysActual: [] });
    const todaySummary2 = computeForecastSummary({ selectedDate: now, latestVintage, now, todayActualIntervals: todayActual, priorDaysActual: [] });

    // Today: actual(midnight..12:00, 25kW*12h=300) + remaining(12:00..24:00, 10kW*12h=120) = 420.
    expect(todaySummary1.dailyForecastKwh).toBeCloseTo(420, 1);
    // The other (past) day must show its OWN plain persisted total (8kW*24h=192), completely untouched by
    // today's actual data, even though the same todayActualIntervals value was passed in.
    expect(otherSummary.dailyForecastKwh).toBe(192);
    expect(otherSummary.dailyPeakKw).toBe(8);
    // Switching back to today must reproduce the exact same today figure - no cross-contamination either direction.
    expect(todaySummary2.dailyForecastKwh).toBe(todaySummary1.dailyForecastKwh);
  });

  test("forecast-vintage change during the day: daily total is identical whether the live vintage has full-day coverage or only from-generation-time coverage", () => {
    const todayStart = sofiaDayStart(new Date("2026-08-12T00:00:00.000Z"));
    const now = new Date(todayStart.getTime() + 13 * 60 * 60 * 1000); // 13:00 Sofia - mid-day, after a hypothetical 12:10 refresh
    const todayActual = actualIntervals(todayStart, now, 20); // 20 kW * 13h = 260 kWh actual so far

    // Vintage A: generated at 00:10, has full midnight-to-midnight rows (the "yesterday's refresh still live" case).
    const vintageAIntervals = dailyIntervals(todayStart, 10);
    const vintageA = makeVintage(new Date(todayStart.getTime() + 10 * 60 * 1000), vintageAIntervals);

    // Vintage B: generated at 12:10, rows only from 12:15 onward (the "today's own refresh just went live" case) -
    // reproduces the exact real-world 729.9 kWh scenario's row shape. Same 10 kW forecast rate as vintage A for
    // every row that exists in both, so the genuinely-remaining (>= now) rows are identical between the two.
    const generationTime = new Date(todayStart.getTime() + 12 * 60 * 60 * 1000 + 10 * 60 * 1000);
    const vintageBIntervals = vintageAIntervals.filter((iv) => iv.targetIntervalStart.getTime() >= generationTime.getTime());
    const vintageB = makeVintage(generationTime, vintageBIntervals);

    const summaryA = computeForecastSummary({ selectedDate: now, latestVintage: vintageA, now, todayActualIntervals: todayActual, priorDaysActual: [] });
    const summaryB = computeForecastSummary({ selectedDate: now, latestVintage: vintageB, now, todayActualIntervals: todayActual, priorDaysActual: [] });

    // Both must agree: actual(midnight..13:00, 260) + remaining(13:00..24:00, 11h*10kW=110) = 370.
    // Vintage B has fewer total rows than A (no pre-generation-time rows) but that's irrelevant here, since only
    // rows >= now are ever used for "remaining" - proving the fix's total no longer depends on vintage generation time.
    expect(summaryA.dailyForecastKwh).toBeCloseTo(370, 1);
    expect(summaryB.dailyForecastKwh).toBeCloseTo(370, 1);
    expect(summaryA.dailyForecastKwh).toBe(summaryB.dailyForecastKwh);
  });
});

test.describe("computeForecastSummary — Week/Month full-period fix: elapsed days use real actual production, not just remaining forecast", () => {
  test("weekly total = actual for every already-elapsed day + today's actual+remaining + forecast for remaining future days (middle-of-period)", () => {
    // A Thursday: Mon/Tue/Wed already elapsed, Thu is today (partial), Fri/Sat/Sun still ahead.
    const selected = new Date("2026-08-20T09:00:00.000Z");
    const weekBounds = localWeekBoundsUtc(selected, SOFIA);
    const todayStart = sofiaDayStart(selected);
    const now = new Date(todayStart.getTime() + 10 * 60 * 60 * 1000); // 10:00 Sofia

    // Realistic production shape: the vintage only has rows from generation time (= now) forward -
    // Mon/Tue/Wed have NO persisted forecast rows at all, matching real production vintages.
    const remainingTodayAndFuture = dailyIntervals(todayStart, 10).filter((iv) => iv.targetIntervalStart.getTime() >= now.getTime());
    const fridayStart = new Date(todayStart.getTime() + DAY_MS);
    const saturdayStart = new Date(fridayStart.getTime() + DAY_MS);
    const sundayStart = new Date(saturdayStart.getTime() + DAY_MS);
    const intervals = [
      ...remainingTodayAndFuture,
      ...dailyIntervals(fridayStart, 12),
      ...dailyIntervals(saturdayStart, 8),
      ...dailyIntervals(sundayStart, 9),
    ];
    const latestVintage = makeVintage(now, intervals);

    const todayActual = actualIntervals(todayStart, now, 6); // 10h * 6kW = 60 kWh so far today
    const priorDaysActual = [
      elapsedDay(new Date(weekBounds.start.getTime()), 700), // Monday
      elapsedDay(new Date(weekBounds.start.getTime() + DAY_MS), 650), // Tuesday
      elapsedDay(new Date(weekBounds.start.getTime() + 2 * DAY_MS), 690), // Wednesday
    ];

    const summary = computeForecastSummary({ selectedDate: selected, latestVintage, now, todayActualIntervals: todayActual, priorDaysActual });

    // Elapsed prior days: 700 + 650 + 690 = 2040.
    // Today: actual 60 + remaining (14h * 10kW = 140) = 200.
    // Fri/Sat/Sun forecast: 12*24 + 8*24 + 9*24 = 288 + 192 + 216 = 696.
    // Total: 2040 + 200 + 696 = 2936.
    expect(summary.weeklyForecastKwh).toBeCloseTo(2936, 1);

    // Critically: the total must be greater than what's already been produced
    // this week alone (2040 + 60 = 2100) - the exact property the production bug violated.
    expect(summary.weeklyForecastKwh as number).toBeGreaterThan(2040 + 60);
  });

  test("monthly total follows the same logic across elapsed days, today, and future days", () => {
    const selected = new Date("2026-08-20T09:00:00.000Z");
    const monthBounds = localMonthBoundsUtc(selected, SOFIA);
    const todayStart = sofiaDayStart(selected);
    const now = new Date(todayStart.getTime() + 8 * 60 * 60 * 1000);

    const remainingToday = dailyIntervals(todayStart, 10).filter((iv) => iv.targetIntervalStart.getTime() >= now.getTime());
    const tomorrowStart = new Date(todayStart.getTime() + DAY_MS);
    const intervals = [...remainingToday, ...dailyIntervals(tomorrowStart, 20)];
    const latestVintage = makeVintage(now, intervals);

    // 19 elapsed days before today (Aug 1-19), 500 kWh/day each - realistic magnitude.
    const priorDaysActual: ElapsedDayActual[] = [];
    for (let t = monthBounds.start.getTime(); t < todayStart.getTime(); t += DAY_MS) {
      priorDaysActual.push(elapsedDay(new Date(t), 500));
    }
    const elapsedDaysCount = priorDaysActual.length;

    const todayActual = actualIntervals(todayStart, now, 5); // 8h * 5kW = 40 kWh so far

    const summary = computeForecastSummary({ selectedDate: selected, latestVintage, now, todayActualIntervals: todayActual, priorDaysActual });

    const alreadyProducedThisMonth = elapsedDaysCount * 500 + 40;
    expect(summary.monthlyForecastKwh as number).toBeGreaterThan(alreadyProducedThisMonth);

    // Exact total: elapsed days (elapsedDaysCount * 500) + today (40 actual + 16h*10kW=160 remaining = 200)
    // + tomorrow's full day (20kW*24h=480) + every day after tomorrow within the month has NO persisted
    // forecast and NO actual (a real "no data yet" gap) - contributes 0, doesn't break the sum.
    expect(summary.monthlyForecastKwh).toBeCloseTo(elapsedDaysCount * 500 + 200 + 480, 1);
  });

  test("first day of the period: today IS the period start, no elapsed prior days exist", () => {
    const selected = new Date("2026-08-17T09:00:00.000Z"); // a Monday - the week's own first day
    const weekBounds = localWeekBoundsUtc(selected, SOFIA);
    expect(sofiaDayStart(selected).getTime()).toBe(weekBounds.start.getTime());

    const now = new Date(weekBounds.start.getTime() + 9 * 60 * 60 * 1000);
    const remainingToday = dailyIntervals(weekBounds.start, 10).filter((iv) => iv.targetIntervalStart.getTime() >= now.getTime());
    const tuesdayStart = new Date(weekBounds.start.getTime() + DAY_MS);
    const intervals = [...remainingToday, ...dailyIntervals(tuesdayStart, 10)];
    const latestVintage = makeVintage(now, intervals);
    const todayActual = actualIntervals(weekBounds.start, now, 4); // 9h * 4kW = 36 kWh

    // No prior elapsed days can exist - passing an empty array is the correct, natural input.
    const summary = computeForecastSummary({ selectedDate: selected, latestVintage, now, todayActualIntervals: todayActual, priorDaysActual: [] });

    // Today: 36 actual + (15h * 10kW = 150 remaining) = 186. Rest of the week (6 future days) unaffected by this test's assertion.
    expect(summary.weeklyForecastKwh as number).toBeGreaterThanOrEqual(186);
  });

  test("last day of the period: today IS the period end, zero remaining future days", () => {
    const selected = new Date("2026-08-23T09:00:00.000Z"); // a Sunday - the week's own last day
    const weekBounds = localWeekBoundsUtc(selected, SOFIA);
    const todayStart = sofiaDayStart(selected);
    expect(new Date(todayStart.getTime() + DAY_MS).getTime()).toBe(weekBounds.end.getTime());

    const now = new Date(todayStart.getTime() + 14 * 60 * 60 * 1000);
    const remainingToday = dailyIntervals(todayStart, 8).filter((iv) => iv.targetIntervalStart.getTime() >= now.getTime());
    const latestVintage = makeVintage(now, remainingToday);
    const todayActual = actualIntervals(todayStart, now, 12); // 14h * 12kW = 168 kWh
    const priorDaysActual = [
      elapsedDay(weekBounds.start, 600),
      elapsedDay(new Date(weekBounds.start.getTime() + DAY_MS), 620),
      elapsedDay(new Date(weekBounds.start.getTime() + 2 * DAY_MS), 610),
      elapsedDay(new Date(weekBounds.start.getTime() + 3 * DAY_MS), 590),
      elapsedDay(new Date(weekBounds.start.getTime() + 4 * DAY_MS), 630),
      elapsedDay(new Date(weekBounds.start.getTime() + 5 * DAY_MS), 615),
    ];

    const summary = computeForecastSummary({ selectedDate: selected, latestVintage, now, todayActualIntervals: todayActual, priorDaysActual });

    // Elapsed Mon-Sat: 600+620+610+590+630+615 = 3665. Today: 168 actual + (10h*8kW=80 remaining) = 248.
    // No future days remain in the period (today is the last day). Total: 3913.
    expect(summary.weeklyForecastKwh).toBeCloseTo(3913, 1);
  });

  test("no actual data for an elapsed day (producedKwh: null, a genuine sync gap) contributes 0, never NaN or a thrown error", () => {
    const selected = new Date("2026-08-20T09:00:00.000Z");
    const weekBounds = localWeekBoundsUtc(selected, SOFIA);
    const todayStart = sofiaDayStart(selected);
    const now = new Date(todayStart.getTime() + 9 * 60 * 60 * 1000);
    const remainingToday = dailyIntervals(todayStart, 10).filter((iv) => iv.targetIntervalStart.getTime() >= now.getTime());
    const latestVintage = makeVintage(now, remainingToday);
    const todayActual = actualIntervals(todayStart, now, 5);

    const priorDaysActual = [
      elapsedDay(weekBounds.start, 600), // Monday: real data
      elapsedDay(new Date(weekBounds.start.getTime() + DAY_MS), null), // Tuesday: sync gap
      elapsedDay(new Date(weekBounds.start.getTime() + 2 * DAY_MS), 610), // Wednesday: real data
    ];

    const summary = computeForecastSummary({ selectedDate: selected, latestVintage, now, todayActualIntervals: todayActual, priorDaysActual });

    expect(summary.weeklyForecastKwh).not.toBeNull();
    expect(Number.isNaN(summary.weeklyForecastKwh)).toBe(false);
    // 600 + 0 (gap) + 610 + today (45 actual + 150 remaining = 195) = 1405.
    expect(summary.weeklyForecastKwh).toBeCloseTo(1405, 1);
  });

  test("missing forecast data for a future day contributes 0 for that day only - does not collapse the whole period to null", () => {
    const selected = new Date("2026-08-20T09:00:00.000Z");
    const todayStart = sofiaDayStart(selected);
    const now = new Date(todayStart.getTime() + 9 * 60 * 60 * 1000);
    const remainingToday = dailyIntervals(todayStart, 10).filter((iv) => iv.targetIntervalStart.getTime() >= now.getTime());
    // Friday deliberately has NO forecast rows at all (e.g. the vintage's horizon happened to stop short) -
    // Saturday does. Both are genuinely future days within the week.
    const saturdayStart = new Date(todayStart.getTime() + 2 * DAY_MS);
    const intervals = [...remainingToday, ...dailyIntervals(saturdayStart, 10)];
    const latestVintage = makeVintage(now, intervals);
    const todayActual = actualIntervals(todayStart, now, 5);

    const summary = computeForecastSummary({ selectedDate: selected, latestVintage, now, todayActualIntervals: todayActual, priorDaysActual: [] });

    // Today (45 + 150 = 195) + Friday (0, no data) + Saturday (240) + Sun/Mon-Wed already elapsed but
    // priorDaysActual is [] here (isolating this test to the "missing future data" case only) = 435,
    // never null just because one future day has no persisted forecast.
    expect(summary.weeklyForecastKwh).not.toBeNull();
    expect(summary.weeklyForecastKwh).toBeCloseTo(195 + 240, 1);
  });

  test("does not double-count: a prior elapsed day that (unrealistically) has BOTH persisted forecast rows and a priorDaysActual entry counts only the actual", () => {
    const selected = new Date("2026-08-20T09:00:00.000Z");
    const weekBounds = localWeekBoundsUtc(selected, SOFIA);
    const todayStart = sofiaDayStart(selected);
    const now = new Date(todayStart.getTime() + 9 * 60 * 60 * 1000);

    const remainingToday = dailyIntervals(todayStart, 10).filter((iv) => iv.targetIntervalStart.getTime() >= now.getTime());
    // Monday has a full day of (stale) forecast rows lingering in the vintage AND a real actual total -
    // this should never occur in production (vintages never carry past-day rows) but the aggregation
    // must still be safe if it did.
    const mondayForecast = dailyIntervals(weekBounds.start, 999); // absurdly high, to make a double-count obvious if it happened
    const intervals = [...mondayForecast, ...remainingToday];
    const latestVintage = makeVintage(now, intervals);
    const todayActual = actualIntervals(todayStart, now, 5);
    const priorDaysActual = [elapsedDay(weekBounds.start, 600)];

    const summary = computeForecastSummary({ selectedDate: selected, latestVintage, now, todayActualIntervals: todayActual, priorDaysActual });

    // Monday must contribute exactly 600 (the actual), never 999*24=23976 (the forecast) and never both.
    // Today: 45 + 150 = 195. Total: 795.
    expect(summary.weeklyForecastKwh).toBeCloseTo(795, 1);
  });

  test("a genuinely past week/month (not containing today) is completely unaffected by priorDaysActual - Known scope boundary preserved", () => {
    // Vintage rows live in a completely different month (December) from the
    // selected past date (August) and real "now" (September) - so neither
    // weekBounds nor monthBounds around `pastDate` has ANY persisted
    // forecast coverage, isolating this test to "zero data, does a bogus
    // priorDaysActual leak in anyway" rather than mixing in unrelated,
    // pre-existing vintage-coverage behavior.
    const issuedAt = new Date("2026-12-15T00:10:00.000Z");
    const intervals = dailyIntervals(issuedAt, 10);
    const latestVintage = makeVintage(issuedAt, intervals);
    const pastDate = new Date("2026-08-01T12:00:00.000Z");
    const now = new Date("2026-09-16T00:00:00.000Z"); // well after pastDate's entire month, well before the vintage's own December rows

    const bogusPriorDays = [elapsedDay(pastDate, 99999)];
    const summary = computeForecastSummary({ selectedDate: pastDate, latestVintage, now, todayActualIntervals: [], priorDaysActual: bogusPriorDays });

    // Must remain null exactly as before this fix - a fully past period is never patched with actual data,
    // and the bogus 99999 prior-day figure must never leak into a period that doesn't contain "now".
    expect(summary.weeklyForecastKwh).toBeNull();
    expect(summary.monthlyForecastKwh).toBeNull();
  });
});

test.describe("computeForecastSummary — PRODUCT INVARIANT: periodForecast >= actualProductionAlreadyCompletedInPeriod", () => {
  /**
   * The invariant this whole milestone exists to satisfy, stated as its own
   * explicit, named test rather than only implied by the "GreaterThan"
   * assertions embedded in the scenario tests above - if this test ever
   * fails, the Forecast card is showing a mathematically impossible number
   * (a "full period" total smaller than what's already, definitely
   * happened), exactly the production defect reported against Atlanta
   * (11.57 MWh forecast vs. 22.38 MWh already produced) and Chomakovtsi
   * (5.83 MWh vs. 13.56 MWh) before this fix.
   */
  test("exact worked example: 22,000 kWh already produced + 10,000 kWh remaining forecast = 32,000 kWh monthly total (never 10,000, never anything below 22,000)", () => {
    const selected = new Date("2026-08-20T09:00:00.000Z");
    const monthBounds = localMonthBoundsUtc(selected, SOFIA);
    const todayStart = sofiaDayStart(selected);
    const now = new Date(todayStart.getTime() + 9 * 60 * 60 * 1000);

    // 19 elapsed days summing to exactly 20,000 kWh (not including today).
    const priorDaysActual: ElapsedDayActual[] = [];
    for (let i = 0; i < 19; i += 1) {
      priorDaysActual.push(elapsedDay(new Date(monthBounds.start.getTime() + i * DAY_MS), 20000 / 19));
    }
    // Today's actual-so-far: 2,000 kWh - elapsed total (19 days + today) = 22,000 kWh.
    const todayActual = actualIntervals(todayStart, now, (2000 / 9)); // 9h elapsed so far

    // Remaining forecast (today's remainder + every future day) sums to exactly 10,000 kWh.
    // Today's own remaining rows: 0 (all of today's forecast budget is spent on future days here, for a clean split).
    const futureDaysCount = 11; // enough future days to reach the month end from day 20
    const perFutureDayKwh = 10000 / futureDaysCount;
    const perFutureDayKw = perFutureDayKwh / 24;
    const intervals: PersistedForecastInterval[] = [];
    for (let i = 1; i <= futureDaysCount; i += 1) {
      const dayStart = new Date(todayStart.getTime() + i * DAY_MS);
      if (dayStart.getTime() < monthBounds.end.getTime()) {
        intervals.push(...dailyIntervals(dayStart, perFutureDayKw));
      }
    }
    const latestVintage = makeVintage(now, intervals);

    const summary = computeForecastSummary({ selectedDate: selected, latestVintage, now, todayActualIntervals: todayActual, priorDaysActual });

    expect(summary.monthlyForecastKwh).toBeCloseTo(32000, 0);
    expect(summary.monthlyForecastKwh).not.toBeCloseTo(10000, 0);
    expect(summary.monthlyForecastKwh as number).toBeGreaterThanOrEqual(22000);
  });

  test("when the forecast horizon does not cover the entire remaining calendar period, uncovered days contribute 0 - never fabricated, never silently treated as 'the whole remaining month'", () => {
    // 20 elapsed days, today makes 21, 10 more days remain in a 31-day
    // month (11 days "remain" counting today) - but the persisted vintage's
    // horizon only covers the next 7 days from today (today + 6 future
    // days), leaving the final 4 days of the month with NO persisted
    // forecast at all - a real, possible production state (e.g. a
    // shortened horizon, a partial refresh failure, or simply a horizon
    // config change), not something this function may ever paper over by
    // treating the 7-day horizon as if it were the whole remaining month.
    const monthStart = sofiaDayStart(new Date("2026-08-01T00:00:00.000Z"));
    const selected = new Date(monthStart.getTime() + 20 * DAY_MS + 9 * 60 * 60 * 1000); // Aug 21, 09:00
    const todayStart = sofiaDayStart(selected);
    const now = selected;

    const priorDaysActual: ElapsedDayActual[] = [];
    for (let i = 0; i < 20; i += 1) {
      priorDaysActual.push(elapsedDay(new Date(monthStart.getTime() + i * DAY_MS), 500)); // 20 * 500 = 10,000 kWh elapsed
    }
    const todayActual = actualIntervals(todayStart, now, 4); // 9h * 4kW = 36 kWh so far today

    // Forecast vintage covers today (remaining hours) + only 6 more days (7-day horizon total) = through Aug 27.
    // Aug 28-31 (4 days) intentionally have ZERO persisted rows.
    const todayRemaining = dailyIntervals(todayStart, 10).filter((iv) => iv.targetIntervalStart.getTime() >= now.getTime());
    const intervals = [...todayRemaining];
    for (let i = 1; i <= 6; i += 1) {
      intervals.push(...dailyIntervals(new Date(todayStart.getTime() + i * DAY_MS), 20)); // 20 kW * 24h = 480 kWh/day
    }
    const latestVintage = makeVintage(now, intervals);

    const summary = computeForecastSummary({ selectedDate: selected, latestVintage, now, todayActualIntervals: todayActual, priorDaysActual });

    // Elapsed 20 days: 10,000. Today: 36 actual + (15h * 10kW = 150 remaining) = 186.
    // Aug22-27 (6 covered future days): 480 * 6 = 2880. Aug28-31 (4 uncovered days): 0, not fabricated.
    const expectedTotal = 10000 + 186 + 2880;
    expect(summary.monthlyForecastKwh).toBeCloseTo(expectedTotal, 1);

    // Documents the INTENDED behavior explicitly: this total honestly represents "actual + whatever forecast
    // horizon is actually available," NOT the true expected full-month total (which would need the missing 4
    // days too, currently a real, undecided product question - see the investigation report, not this test).
    // It must still never be LESS than what's already been produced (the invariant above).
    expect(summary.monthlyForecastKwh as number).toBeGreaterThanOrEqual(10000 + 36);
  });

  test("weekly and monthly deltas against actual-so-far are always non-negative, for a realistic multi-day scenario", () => {
    const selected = new Date("2026-08-20T09:00:00.000Z");
    const weekBounds = localWeekBoundsUtc(selected, SOFIA);
    const monthBounds = localMonthBoundsUtc(selected, SOFIA);
    const todayStart = sofiaDayStart(selected);
    const now = new Date(todayStart.getTime() + 11 * 60 * 60 * 1000);

    const priorDaysActual: ElapsedDayActual[] = [];
    for (let t = monthBounds.start.getTime(); t < todayStart.getTime(); t += DAY_MS) {
      priorDaysActual.push(elapsedDay(new Date(t), 640)); // realistic Chomakovtsi-shaped magnitude
    }
    const todayActual = actualIntervals(todayStart, now, 45); // 11h * 45kW = 495 kWh so far
    const remainingToday = dailyIntervals(todayStart, 10).filter((iv) => iv.targetIntervalStart.getTime() >= now.getTime());
    const futureDays: PersistedForecastInterval[] = [];
    for (let t = new Date(todayStart.getTime() + DAY_MS).getTime(); t < monthBounds.end.getTime(); t += DAY_MS) {
      futureDays.push(...dailyIntervals(new Date(t), 20));
    }
    const latestVintage = makeVintage(now, [...remainingToday, ...futureDays]);

    const summary = computeForecastSummary({ selectedDate: selected, latestVintage, now, todayActualIntervals: todayActual, priorDaysActual });

    const weekActualSoFar = priorDaysActual
      .filter((d) => d.localDate.getTime() >= weekBounds.start.getTime() && d.localDate.getTime() < weekBounds.end.getTime())
      .reduce((s, d) => s + (d.producedKwh ?? 0), 0) + sumActualForTest(todayActual);
    const monthActualSoFar = priorDaysActual.reduce((s, d) => s + (d.producedKwh ?? 0), 0) + sumActualForTest(todayActual);

    expect((summary.weeklyForecastKwh as number) - weekActualSoFar).toBeGreaterThanOrEqual(-0.01);
    expect((summary.monthlyForecastKwh as number) - monthActualSoFar).toBeGreaterThanOrEqual(-0.01);
    // The selected week is fully inside the selected month here (Aug 17-23 inside August) - monthly must be >= weekly.
    expect(summary.monthlyForecastKwh as number).toBeGreaterThanOrEqual(summary.weeklyForecastKwh as number);
  });
});
