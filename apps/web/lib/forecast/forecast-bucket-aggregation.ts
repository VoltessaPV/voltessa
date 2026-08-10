/**
 * Dashboard Forecast Architecture Correction / Week-Month Forecast
 * Correction milestones. Pure daily-bucket aggregation over a persisted
 * forecast vintage — no Prisma, no Next.js, no network. Extracted out of
 * `dashboard-data.ts` (which still owns everything else about assembling
 * the Dashboard page) specifically so this logic — the exact place two
 * real production bugs were found (missing `periodStart` lower bound, and
 * `weeklyForecastKwh` using a different date window than the Week chart's
 * own daily buckets) — can be unit-tested in isolation, without dragging in
 * `dashboard-data.ts`'s full transitive import graph (Prisma, market/
 * production data, next-intl message loading, ...) which only works inside
 * a real Next.js runtime. See `e2e/forecast-bucket-aggregation.spec.ts`.
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

/** `YYYY-MM-DD` bucket key for a given instant, in Europe/Sofia. */
function dayBucketKey(instant: Date): string {
  return formatDateInZone(instant, BULGARIA_TIMEZONE);
}

/**
 * Live Energy Forecast Integration milestone. The compact forecast
 * summary rendered inside/below the Live Energy card — every figure is
 * always relative to real "now", regardless of which toolbar period
 * (Today/Week/Month) the chart above happens to be displaying, since
 * "what's forecast starting right now" doesn't depend on which historical
 * period a user happens to be browsing.
 *
 * - `dailyForecastKwh`: total expected PV energy for the current calendar
 *   day — today's real actual-so-far plus the forecast for the rest of
 *   today. Deliberately distinct from `remainingTodayKwh` (forecast only,
 *   from now onward) — the prior single "expected energy" framing (a
 *   rolling next-8-hours window) was found to be the actual cause of an
 *   apparent forecast-vs-actual mismatch a user reported (691.4 kWh over a
 *   partial window vs. >1,000 kWh for a full historical day — not a
 *   calculation defect): comparing a partial-day figure against a
 *   full-day one always looks wrong even when the forecast itself is
 *   correct. Having both an unambiguous full-day figure and an explicitly
 *   labelled remaining-only figure removes that ambiguity structurally.
 * - `remainingTodayKwh`: forecast only, from now through the end of today.
 * - `weeklyForecastKwh`: the current ISO Mon-Sun calendar week containing
 *   today — the EXACT SAME 7 days the toolbar's own "Week" period shows
 *   (`localWeekBoundsUtc`), not a rolling "next 7 days" window. This was
 *   previously a rolling window, deliberately documented as different from
 *   the chart — but that meant this figure and the Week chart's own daily
 *   forecast buckets could never be added up to the same total, which
 *   defeats the whole point of showing them side by side. Now: elapsed
 *   days' real actuals + today's actual-so-far + remaining days' forecast,
 *   summed over precisely the 7 days the chart draws — this number must
 *   always equal the sum of the Week chart's own daily points.
 * - `monthlyForecastKwh`: the entire current calendar month — real actual
 *   production for every already-elapsed day, plus forecast for every day
 *   (including today's remainder) that hasn't happened yet. Same calendar
 *   month bounds (`localMonthBoundsUtc`) the Month chart itself uses, for
 *   the same reason.
 * - `peakForecastKw`: maximum forecast PV power for the remaining-today
 *   window specifically (see `peakForecastKw`'s own label in the UI).
 * - `confidence`: a simple, non-statistical label for the remaining-today
 *   forecast specifically (see `lib/forecast/forecast-tiers.ts`) — `null`
 *   only when there is no remaining-today forecast left to grade (e.g.
 *   viewed after sunset with nothing left today).
 */
export type ForecastSummary = {
  dailyForecastKwh: number | null;
  remainingTodayKwh: number | null;
  weeklyForecastKwh: number | null;
  monthlyForecastKwh: number | null;
  peakForecastKw: number | null;
  confidence: ForecastConfidence | null;
  modelVersion: string;
  weatherSource: string;
  /** When the persisted forecast vintage this summary is derived from was generated — lets the UI show a subtle "Forecast updated HH:MM" / staleness indication (item 13) without pretending a stale vintage is fresh. */
  issuedAt: Date;
};

/**
 * Dashboard Forecast Architecture Correction milestone. Groups the
 * persisted forecast vintage's intervals into the exact same Sofia-local
 * calendar-day buckets `buildPeriodChartSeries` uses (`bucketKey`), summing
 * each future day's `forecastKwh` (never `forecastKw` — a day total is a
 * sum of energy, not power) into one per-day total — only for intervals at
 * or after `overlayStart` and before `periodEnd`, so a bucket that's
 * already elapsed never gets a forecast value alongside its real actual
 * one (item 4's merge rule: actual wins for every settled interval, no
 * matter how old the persisted vintage is).
 *
 * `overlayStart` is `max(now, periodStart)`, not bare `now` — for the
 * *current* week/month this is the same thing, but for a period entirely
 * in the future (the user has navigated forward), `now` alone would let
 * intervals from today through the day before `periodStart` leak into a
 * chart that's supposed to show only that future period's own days. A
 * period entirely in the past never reaches this function at all (gated
 * by `periodCoversNow` at the call site).
 *
 * Today's own bucket is handled separately via `todayFullDayForecastKwh`
 * — the *full* projected day total (today's real actual-so-far + the
 * remaining forecast, i.e. the same quantity `ForecastSummary.dailyForecastKwh`
 * already reports), not just the remaining sliver — so the grey series
 * reads as one coherent "forecast total per day" line that continues
 * smoothly from today into future days, instead of dipping to a
 * much-smaller "remaining only" figure at the exact point today's green
 * actual line is also plotted. Only injected when today's own calendar day
 * genuinely falls within `[periodStart, periodEnd)` — otherwise (browsing
 * a future week/month that doesn't contain today) this would incorrectly
 * inject a "today" point into a period that doesn't include today at all.
 * Keyed by that day's own local-midnight instant (`localDayBoundsUtc`) so
 * the result lines up with `buildPeriodChartSeries`'s own bucket
 * timestamps exactly, including for a future day that has no actual row
 * yet at all (and therefore isn't in `bucketInstant` on that side).
 */
export function buildDailyForecastBucketMap(
  intervals: PersistedForecastInterval[],
  now: Date,
  periodStart: Date,
  periodEnd: Date,
  todayFullDayForecastKwh: number | null,
): Map<number, number> {
  const overlayStart = now.getTime() > periodStart.getTime() ? now : periodStart;
  const todayKey = dayBucketKey(now);
  const kwhByDayKey = new Map<string, number>();
  const instantByDayKey = new Map<string, number>();

  for (const interval of intervals) {
    if (
      interval.targetIntervalStart.getTime() < overlayStart.getTime() ||
      interval.targetIntervalStart.getTime() >= periodEnd.getTime()
    ) {
      continue;
    }
    const key = dayBucketKey(interval.targetIntervalStart);
    if (key === todayKey) {
      continue;
    }
    kwhByDayKey.set(key, (kwhByDayKey.get(key) ?? 0) + interval.forecastKwh);
    if (!instantByDayKey.has(key)) {
      instantByDayKey.set(key, localDayBoundsUtc(interval.targetIntervalStart, BULGARIA_TIMEZONE).start.getTime());
    }
  }

  const result = new Map<number, number>();
  for (const [key, kwh] of kwhByDayKey) {
    result.set(instantByDayKey.get(key) as number, Math.round(kwh * 100) / 100);
  }

  const todayWithinPeriod = now.getTime() >= periodStart.getTime() && now.getTime() < periodEnd.getTime();
  if (todayFullDayForecastKwh !== null && todayWithinPeriod) {
    const todayInstant = localDayBoundsUtc(now, BULGARIA_TIMEZONE).start.getTime();
    result.set(todayInstant, Math.round(todayFullDayForecastKwh * 100) / 100);
  }

  return result;
}

/**
 * Computes the compact forecast summary (Daily/Remaining today/Weekly/
 * Monthly/Peak/confidence) entirely from already-fetched, cheap inputs — a
 * persisted forecast vintage (`getLatestForecastVintage`, a couple of
 * indexed DB reads, never a live computation) and real actual production
 * (`todayActualSoFarKwh`/`weekActualSoFarKwh`/`monthActualSoFarKwh`, all
 * `PlantDailyKpi`-backed KPI-card sources).
 *
 * `now` is the merge boundary for every total below: per this milestone's
 * explicit merge rule ("actual wins for every settled interval, no matter
 * how old the persisted vintage is"), any persisted interval at or before
 * `now` is skipped even though the vintage itself may have been issued
 * many hours earlier and its own intervals span back to its own issuance
 * time — without this filter, a forecast generated at 00:10 would still
 * "predict" the whole day at 15:00, double-counting or contradicting
 * hours that already have real actuals.
 */
export function computeForecastSummary(params: {
  now: Date;
  latestVintage: LatestForecastVintage;
  todayActualSoFarKwh: number | null;
  weekActualSoFarKwh: number | null;
  monthActualSoFarKwh: number | null;
}): ForecastSummary {
  const { now, latestVintage, todayActualSoFarKwh, weekActualSoFarKwh, monthActualSoFarKwh } = params;

  const todayBounds = localDayBoundsUtc(now, BULGARIA_TIMEZONE);
  const weekBounds = localWeekBoundsUtc(now, BULGARIA_TIMEZONE);
  const monthBounds = localMonthBoundsUtc(now, BULGARIA_TIMEZONE);

  const futureIntervals = latestVintage.intervals.filter((interval) => interval.targetIntervalStart.getTime() >= now.getTime());

  const remainingTodayIntervals = futureIntervals.filter(
    (interval) => interval.targetIntervalStart.getTime() < todayBounds.end.getTime(),
  );
  const remainingTodayKwh =
    remainingTodayIntervals.length > 0 ? remainingTodayIntervals.reduce((sum, i) => sum + i.forecastKwh, 0) : null;
  const peakForecastKw =
    remainingTodayIntervals.length > 0 ? Math.max(...remainingTodayIntervals.map((i) => i.forecastKw)) : null;
  const confidence = remainingTodayIntervals[0]?.confidence ?? null;

  const actualSoFarKwh = todayActualSoFarKwh ?? 0;
  const dailyForecastKwh = actualSoFarKwh + (remainingTodayKwh ?? 0);

  // Same ISO Mon-Sun week the toolbar's own "Week" period and chart use
  // (`localWeekBoundsUtc`) — see this function's own doc comment above and
  // `ForecastSummary`'s. `weekActualSoFarKwh` covers every already-elapsed
  // day of the week strictly before today (empty/`null` when today is the
  // week's own Monday); `actualSoFarKwh` covers today; the forecast covers
  // every remaining interval through the week's end — together, exactly
  // the same three-part composition the Week chart's daily buckets use, so
  // the two must sum to the same total.
  const weekForecastKwh = futureIntervals
    .filter((interval) => interval.targetIntervalStart.getTime() < weekBounds.end.getTime())
    .reduce((sum, interval) => sum + interval.forecastKwh, 0);
  const weeklyForecastKwh = (weekActualSoFarKwh ?? 0) + actualSoFarKwh + weekForecastKwh;

  const monthForecastRemainingKwh = futureIntervals
    .filter((interval) => interval.targetIntervalStart.getTime() < monthBounds.end.getTime())
    .reduce((sum, interval) => sum + interval.forecastKwh, 0);
  const monthlyForecastKwh = (monthActualSoFarKwh ?? 0) + actualSoFarKwh + monthForecastRemainingKwh;

  return {
    dailyForecastKwh: Math.round(dailyForecastKwh * 100) / 100,
    remainingTodayKwh: remainingTodayKwh !== null ? Math.round(remainingTodayKwh * 100) / 100 : null,
    weeklyForecastKwh: Math.round(weeklyForecastKwh * 100) / 100,
    monthlyForecastKwh: Math.round(monthlyForecastKwh * 100) / 100,
    peakForecastKw,
    confidence,
    modelVersion: latestVintage.modelVersion,
    weatherSource: latestVintage.weatherSource,
    issuedAt: latestVintage.issuedAt,
  };
}
