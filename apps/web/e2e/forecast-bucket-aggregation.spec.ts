import { test, expect } from "@playwright/test";

import { buildDailyForecastBucketMap, computeForecastSummary, type TodayActualInterval } from "@/lib/forecast/forecast-bucket-aggregation";
import type { LatestForecastVintage, PersistedForecastInterval } from "@/lib/forecast/forecast-read";
import { localDayBoundsUtc, localMonthBoundsUtc, localWeekBoundsUtc } from "@/lib/market-price/timezone";

/**
 * Forecast Semantics & Measurement Accuracy milestone, plus the Aug 2026
 * "Daily forecast" full-day semantics fix.
 *
 * Original design (still true for any NON-today selected date): every
 * figure is a fixed, deterministic sum/max over the persisted vintage's
 * own rows for the SELECTED day/week/month, never blended with actual
 * production, never dependent on real "now" (see this file's own
 * production-code top doc comment for the original "why" — a prior
 * design that blended actual into a "remaining today" figure was removed
 * because it silently re-fit itself to actual production as the day went
 * on, hiding forecast error instead of exposing it).
 *
 * The full-day semantics fix (confirmed root cause): for TODAY
 * specifically, `latestVintage.intervals` only ever contains rows from
 * the vintage's own generation time forward (`pv-forecast-core.ts`'s
 * `forecastStart = ceilTo15Min(now)` at generation time) — so summing
 * "every persisted row for today" silently produced a *remaining-from-
 * generation-time* total, not a genuine full calendar day, whenever the
 * latest vintage was generated intraday (true for roughly half of every
 * day, between the two daily scheduler runs). Reproduced directly against
 * production data: a live "Daily forecast: 729.9 kWh" for Atlanta was
 * confirmed to be exactly the sum of the 47 persisted rows from 12:15
 * Sofia (generation time) onward, while the prior day's vintage (which
 * DID have full midnight-to-midnight coverage for the same date) forecast
 * ~1088 kWh for it — the true order of magnitude.
 *
 * The fix: `computeForecastSummary` now takes `now` and
 * `todayActualIntervals` (real reconstructed Available PV from local
 * midnight to `now`, only ever consulted when the selected date IS
 * today). For today, `dailyForecastKwh`/`dailyPeakKw` (and any of
 * `weeklyForecastKwh`/`monthlyForecastKwh` whose range contains today)
 * become `actual(midnight..now) + remaining-forecast(now..end-of-day)` —
 * overlap-free by construction, since the remaining-forecast sum only
 * ever includes rows with `targetIntervalStart >= now`. A NON-today
 * selected date is completely unaffected by `now` or
 * `todayActualIntervals` — the original invariant this suite already
 * protected — this is a strictly additive capability, not a redesign of
 * the historical/future path.
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

/** Real Sofia local-day boundary containing `instant` - August has no DST transition, so `start + N * DAY_MS` stays local-day-aligned for every test below. */
function sofiaDayStart(instant: Date): Date {
  return localDayBoundsUtc(instant, SOFIA).start;
}

function makeVintage(issuedAt: Date, intervals: PersistedForecastInterval[]): LatestForecastVintage {
  return { issuedAt, modelVersion: "test", weatherSource: "test", intervals };
}

/** A `now` far outside any date these tests construct - guarantees "today" never accidentally coincides with a test's own synthetic date, for the tests that specifically verify NON-today (now-independent) behavior. */
const UNRELATED_NOW = new Date("2030-01-01T12:00:00.000Z");

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

test.describe("computeForecastSummary — non-today dates remain fixed, deterministic, now-independent", () => {
  test("A. Fixed daily forecast: identical for the same vintage + selected (non-today) date regardless of what instant within that day is asked, and regardless of real now", () => {
    const dayStart = sofiaDayStart(new Date("2026-08-12T00:00:00.000Z"));
    const intervals = dailyIntervals(dayStart, 15); // 15 kW * 24h = 360 kWh
    const latestVintage = makeVintage(dayStart, intervals);

    const morningSelection = new Date(dayStart.getTime() + 2 * 60 * 60 * 1000);
    const eveningSelection = new Date(dayStart.getTime() + 20 * 60 * 60 * 1000);

    // now = UNRELATED_NOW, so this day is never "today" for either call.
    const morning = computeForecastSummary({ selectedDate: morningSelection, latestVintage, now: UNRELATED_NOW, todayActualIntervals: [] });
    const evening = computeForecastSummary({ selectedDate: eveningSelection, latestVintage, now: UNRELATED_NOW, todayActualIntervals: [] });

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

    const withoutActual = computeForecastSummary({ selectedDate: dayStart, latestVintage, now: UNRELATED_NOW, todayActualIntervals: [] });
    const withBogusActual = computeForecastSummary({ selectedDate: dayStart, latestVintage, now: UNRELATED_NOW, todayActualIntervals: bogusActual });

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
    const summary = computeForecastSummary({ selectedDate: middayInstant, latestVintage, now: UNRELATED_NOW, todayActualIntervals: [] });

    expect(summary.dailyPeakKw).toBe(50);
  });

  test("D. Date switching: two different non-today selected dates against the same vintage produce independent results", () => {
    const day1Start = sofiaDayStart(new Date("2026-08-12T00:00:00.000Z"));
    const day2Start = new Date(day1Start.getTime() + DAY_MS);
    const intervals = [...dailyIntervals(day1Start, 10), ...dailyIntervals(day2Start, 25)];
    const latestVintage = makeVintage(day1Start, intervals);

    const d1 = computeForecastSummary({ selectedDate: day1Start, latestVintage, now: UNRELATED_NOW, todayActualIntervals: [] });
    const d2 = computeForecastSummary({ selectedDate: day2Start, latestVintage, now: UNRELATED_NOW, todayActualIntervals: [] });

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
    const summary = computeForecastSummary({ selectedDate: selected, latestVintage, now: UNRELATED_NOW, todayActualIntervals: [] });

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
    const summary = computeForecastSummary({ selectedDate: pastDate, latestVintage, now: new Date("2026-08-16T00:00:00.000Z"), todayActualIntervals: [] });

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

    const futureSummary = computeForecastSummary({ selectedDate: futureDayStart, latestVintage, now, todayActualIntervals: someActual });

    expect(futureSummary.dailyForecastKwh).toBe(720); // 30 kW * 24h, untouched by todayActualIntervals
  });

  test("future day (10 days out) is a plain full-day persisted sum - unaffected by this fix", () => {
    const todayStart = sofiaDayStart(new Date("2026-08-12T00:00:00.000Z"));
    const futureDayStart = new Date(todayStart.getTime() + 10 * DAY_MS);
    const intervals = dailyIntervals(futureDayStart, 12);
    const latestVintage = makeVintage(todayStart, intervals);

    const now = new Date(todayStart.getTime() + 6 * 60 * 60 * 1000);
    const summary = computeForecastSummary({ selectedDate: futureDayStart, latestVintage, now, todayActualIntervals: [] });

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

    const summary = computeForecastSummary({ selectedDate: now, latestVintage, now, todayActualIntervals: actual });

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

    const summary = computeForecastSummary({ selectedDate: now, latestVintage, now, todayActualIntervals: actual });

    // Remaining forecast: 48 quarter-hours (12h) * 20 kW * 0.25 = 240 kWh. Actual: 300 kWh. Total 540.
    expect(summary.dailyForecastKwh).toBeCloseTo(540, 1);
  });

  test("current day, late afternoon: most of the day is realized actual, forecast covers only the remaining hours", () => {
    const todayStart = sofiaDayStart(new Date("2026-08-12T00:00:00.000Z"));
    const now = new Date(todayStart.getTime() + 17 * 60 * 60 * 1000); // 17:00 Sofia
    const intervals = dailyIntervals(todayStart, 15);
    const latestVintage = makeVintage(todayStart, intervals);
    const actual = actualIntervals(todayStart, now, 18); // 18 kW for 17h = 306 kWh actual

    const summary = computeForecastSummary({ selectedDate: now, latestVintage, now, todayActualIntervals: actual });

    // Remaining forecast: 7h (28 quarter-hours) * 15 kW * 0.25 = 105 kWh. Actual 306. Total 411.
    expect(summary.dailyForecastKwh).toBeCloseTo(411, 1);
  });

  test("current day, near sunset (23:45): forecast has essentially nothing left, total is almost entirely realized actual", () => {
    const todayStart = sofiaDayStart(new Date("2026-08-12T00:00:00.000Z"));
    const now = new Date(todayStart.getTime() + 23 * 60 * 60 * 1000 + 45 * 60 * 1000); // 23:45 Sofia
    const intervals = dailyIntervals(todayStart, 10);
    const latestVintage = makeVintage(todayStart, intervals);
    const actual = actualIntervals(todayStart, now, 12); // 12 kW for 23.75h ≈ 285 kWh actual

    const summary = computeForecastSummary({ selectedDate: now, latestVintage, now, todayActualIntervals: actual });

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

    const summary = computeForecastSummary({ selectedDate: now, latestVintage, now, todayActualIntervals: actual });

    // Remaining forecast rows: [06:00, 24:00) = 72 quarter-hours * 10 kW * 0.25 = 180 kWh.
    // Actual: 48 kWh. Total: 228 kWh - the 06:00 row must appear in exactly one side of the sum.
    expect(summary.dailyForecastKwh).toBeCloseTo(228, 1);
  });

  test("midnight boundary: now = exactly local midnight - actual is empty, remaining is the full day", () => {
    const todayStart = sofiaDayStart(new Date("2026-08-12T00:00:00.000Z"));
    const now = todayStart; // exactly 00:00 Sofia
    const intervals = dailyIntervals(todayStart, 10); // 240 kWh full day
    const latestVintage = makeVintage(todayStart, intervals);

    const summary = computeForecastSummary({ selectedDate: now, latestVintage, now, todayActualIntervals: [] });

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

    const summary = computeForecastSummary({ selectedDate: now, latestVintage, now, todayActualIntervals: actual });

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
      return computeForecastSummary({ selectedDate: now, latestVintage, now, todayActualIntervals: actual }).dailyForecastKwh;
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

    const summary = computeForecastSummary({ selectedDate: now, latestVintage, now, todayActualIntervals: actual });

    expect(summary.dailyPeakKw).toBeCloseTo(25, 6);
  });

  test("today with zero remaining forecast rows and zero actual intervals returns null, never a fabricated zero", () => {
    const todayStart = sofiaDayStart(new Date("2026-08-12T00:00:00.000Z"));
    const now = todayStart;
    const latestVintage = makeVintage(todayStart, []); // no persisted rows at all for today
    const summary = computeForecastSummary({ selectedDate: now, latestVintage, now, todayActualIntervals: [] });

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

    const summary = computeForecastSummary({ selectedDate: selected, latestVintage, now, todayActualIntervals: todayActual });

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
    const todaySummary1 = computeForecastSummary({ selectedDate: now, latestVintage, now, todayActualIntervals: todayActual });
    const otherSummary = computeForecastSummary({ selectedDate: otherDayStart, latestVintage, now, todayActualIntervals: todayActual });
    const todaySummary2 = computeForecastSummary({ selectedDate: now, latestVintage, now, todayActualIntervals: todayActual });

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

    const summaryA = computeForecastSummary({ selectedDate: now, latestVintage: vintageA, now, todayActualIntervals: todayActual });
    const summaryB = computeForecastSummary({ selectedDate: now, latestVintage: vintageB, now, todayActualIntervals: todayActual });

    // Both must agree: actual(midnight..13:00, 260) + remaining(13:00..24:00, 11h*10kW=110) = 370.
    // Vintage B has fewer total rows than A (no pre-generation-time rows) but that's irrelevant here, since only
    // rows >= now are ever used for "remaining" - proving the fix's total no longer depends on vintage generation time.
    expect(summaryA.dailyForecastKwh).toBeCloseTo(370, 1);
    expect(summaryB.dailyForecastKwh).toBeCloseTo(370, 1);
    expect(summaryA.dailyForecastKwh).toBe(summaryB.dailyForecastKwh);
  });
});
