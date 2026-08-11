/**
 * Dashboard Forecast Architecture Correction / Week-Month Forecast
 * Correction / Forecast Semantics & Measurement Accuracy milestones. Pure
 * daily-bucket aggregation over a persisted forecast vintage — no Prisma,
 * no Next.js, no network. Extracted out of `dashboard-data.ts` (which still
 * owns everything else about assembling the Dashboard page) specifically so
 * this logic can be unit-tested in isolation, without dragging in
 * `dashboard-data.ts`'s full transitive import graph (Prisma, market/
 * production data, next-intl message loading, ...) which only works inside
 * a real Next.js runtime. See `e2e/forecast-bucket-aggregation.spec.ts`.
 *
 * Forecast Semantics & Measurement Accuracy milestone: every figure below
 * is now a FIXED, deterministic function of the persisted vintage and the
 * SELECTED date alone — never real "now", never blended with actual
 * production. This is a deliberate reversal of this module's own prior
 * design (see git history): the old `computeForecastSummary` mixed
 * "today's real actual-so-far" with "the forecast for the rest of today"
 * into one number that silently changed every time actual production ticked
 * up, and always described real "now" regardless of which date the user had
 * selected. Both were found to defeat the entire purpose of having a
 * forecast: you cannot ask "how close was the forecast to what actually
 * happened" of a number that keeps re-fitting itself to the answer, and you
 * cannot trust a Forecast card that silently shows today's numbers while
 * you're looking at another day. `dailyForecastKwh`/`dailyPeakKw` are now
 * simply "sum/max of whatever the current persisted vintage says for the
 * selected day" — nothing more — and are identical for every render of the
 * same vintage against the same selected date, changing only when the user
 * picks a different date or a new vintage is persisted.
 */
import {
  formatDateInZone,
  localDayBoundsUtc,
  localMonthBoundsUtc,
  localWeekBoundsUtc,
} from "@/lib/market-price/timezone";
import type { LatestForecastVintage, PersistedForecastInterval } from "@/lib/forecast/forecast-read";
import type { ForecastConfidence } from "@/lib/forecast/forecast-tiers";

/** Same Sofia local-day convention `dashboard-data.ts`/`market-data.ts`/`production-data.ts` all hardcode — see those modules' own doc comments for why this isn't read from `Plant.timezone`. */
const BULGARIA_TIMEZONE = "Europe/Sofia";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** `YYYY-MM-DD` bucket key for a given instant, in Europe/Sofia. */
function dayBucketKey(instant: Date): string {
  return formatDateInZone(instant, BULGARIA_TIMEZONE);
}

/**
 * The compact forecast summary rendered inside the Forecast card. Every
 * figure is a fixed, deterministic sum/max over the persisted vintage's own
 * rows for the SELECTED local calendar day/week/month — never filtered by
 * real "now", never blended with actual production (see this module's own
 * top doc comment). `null` only when the current persisted vintage
 * genuinely has no rows covering that window (e.g. a date far enough in the
 * past that it predates the vintage's own forward-looking horizon) — never
 * a fabricated zero.
 *
 * - `dailyForecastKwh`: total forecast PV energy for the entire selected
 *   local calendar day — every persisted interval whose `targetIntervalStart`
 *   falls in that day, summed, full stop.
 * - `dailyPeakKw`: maximum forecast PV power across that SAME full day
 *   (never "remaining hours only").
 * - `weeklyForecastKwh`: the ISO Mon-Sun calendar week containing the
 *   selected date — the exact same 7 days the toolbar's own "Week" period
 *   and chart use (`localWeekBoundsUtc`).
 * - `monthlyForecastKwh`: the entire calendar month containing the selected
 *   date (`localMonthBoundsUtc`), same bounds the Month chart itself uses.
 * - `confidence`: the selected day's own first interval's confidence label
 *   (see `lib/forecast/forecast-tiers.ts`) — `null` only when the day has
 *   no persisted intervals at all.
 */
export type ForecastSummary = {
  dailyForecastKwh: number | null;
  dailyPeakKw: number | null;
  weeklyForecastKwh: number | null;
  monthlyForecastKwh: number | null;
  confidence: ForecastConfidence | null;
  modelVersion: string;
  weatherSource: string;
  /** When the persisted forecast vintage this summary is derived from was generated — lets the UI show a subtle "Forecast updated HH:MM" / staleness indication without pretending a stale vintage is fresh. */
  issuedAt: Date;
};

/** Sums a persisted vintage's `forecastKwh` over intervals whose `targetIntervalStart` falls in `[start, end)`; `null` when none exist. */
function sumIntervalsInRange(intervals: PersistedForecastInterval[], start: Date, end: Date): number | null {
  const matching = intervals.filter(
    (interval) => interval.targetIntervalStart.getTime() >= start.getTime() && interval.targetIntervalStart.getTime() < end.getTime(),
  );
  return matching.length > 0 ? matching.reduce((sum, interval) => sum + interval.forecastKwh, 0) : null;
}

/**
 * Groups the persisted forecast vintage's intervals into the exact same
 * Sofia-local calendar-day buckets `buildPeriodChartSeries` uses
 * (`bucketKey`), summing each day's `forecastKwh` (never `forecastKw` — a
 * day total is a sum of energy, not power) into one per-day total, for
 * every persisted interval within `[periodStart, periodEnd)` — including
 * today's own bucket, computed the exact same way as every other day now
 * (no more special-casing "today" against real "now" — see this module's
 * own top doc comment). A day with no persisted forecast rows at all
 * (e.g. a past day the current vintage's forward-looking horizon never
 * covered) simply has no entry in the returned map.
 */
export function buildDailyForecastBucketMap(
  intervals: PersistedForecastInterval[],
  periodStart: Date,
  periodEnd: Date,
): Map<number, number> {
  const kwhByDayKey = new Map<string, number>();
  const instantByDayKey = new Map<string, number>();

  for (const interval of intervals) {
    if (
      interval.targetIntervalStart.getTime() < periodStart.getTime() ||
      interval.targetIntervalStart.getTime() >= periodEnd.getTime()
    ) {
      continue;
    }
    const key = dayBucketKey(interval.targetIntervalStart);
    kwhByDayKey.set(key, (kwhByDayKey.get(key) ?? 0) + interval.forecastKwh);
    if (!instantByDayKey.has(key)) {
      instantByDayKey.set(key, localDayBoundsUtc(interval.targetIntervalStart, BULGARIA_TIMEZONE).start.getTime());
    }
  }

  const result = new Map<number, number>();
  for (const [key, kwh] of kwhByDayKey) {
    result.set(instantByDayKey.get(key) as number, round2(kwh));
  }
  return result;
}

/**
 * Computes the fixed, deterministic forecast summary entirely from the
 * persisted vintage and the selected date — no actual production input at
 * all (see this module's own top doc comment for why that was removed).
 */
export function computeForecastSummary(params: {
  /** Any instant within the selected local calendar day — this function derives day/week/month bounds from it via `localDayBoundsUtc`/`localWeekBoundsUtc`/`localMonthBoundsUtc`, exactly like `dashboard-data.ts`'s own `referenceInstant`. */
  selectedDate: Date;
  latestVintage: LatestForecastVintage;
}): ForecastSummary {
  const { selectedDate, latestVintage } = params;

  const dayBounds = localDayBoundsUtc(selectedDate, BULGARIA_TIMEZONE);
  const weekBounds = localWeekBoundsUtc(selectedDate, BULGARIA_TIMEZONE);
  const monthBounds = localMonthBoundsUtc(selectedDate, BULGARIA_TIMEZONE);

  const dayIntervals = latestVintage.intervals.filter(
    (interval) =>
      interval.targetIntervalStart.getTime() >= dayBounds.start.getTime() &&
      interval.targetIntervalStart.getTime() < dayBounds.end.getTime(),
  );

  const dailyForecastKwh = dayIntervals.length > 0 ? dayIntervals.reduce((sum, i) => sum + i.forecastKwh, 0) : null;
  const dailyPeakKw = dayIntervals.length > 0 ? Math.max(...dayIntervals.map((i) => i.forecastKw)) : null;
  const confidence = dayIntervals[0]?.confidence ?? null;

  const weeklyForecastKwh = sumIntervalsInRange(latestVintage.intervals, weekBounds.start, weekBounds.end);
  const monthlyForecastKwh = sumIntervalsInRange(latestVintage.intervals, monthBounds.start, monthBounds.end);

  return {
    dailyForecastKwh: dailyForecastKwh !== null ? round2(dailyForecastKwh) : null,
    dailyPeakKw,
    weeklyForecastKwh: weeklyForecastKwh !== null ? round2(weeklyForecastKwh) : null,
    monthlyForecastKwh: monthlyForecastKwh !== null ? round2(monthlyForecastKwh) : null,
    confidence,
    modelVersion: latestVintage.modelVersion,
    weatherSource: latestVintage.weatherSource,
    issuedAt: latestVintage.issuedAt,
  };
}
