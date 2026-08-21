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
 * is a FIXED, deterministic function of the persisted vintage and the
 * SELECTED date alone (never real "now", never blended with actual
 * production) — for any day OTHER than today. This was a deliberate
 * reversal of this module's own prior design (see git history): the old
 * `computeForecastSummary` mixed "today's real actual-so-far" with "the
 * forecast for the rest of today" into one number that silently changed
 * every time actual production ticked up, and always described real "now"
 * regardless of which date the user had selected. Both were found to
 * defeat the entire purpose of having a forecast: you cannot ask "how
 * close was the forecast to what actually happened" of a number that
 * keeps re-fitting itself to the answer, and you cannot trust a Forecast
 * card that silently shows today's numbers while you're looking at
 * another day.
 *
 * Full-day semantics fix (Aug 2026): the above is still exactly true for
 * any non-today day — but for TODAY specifically, a real defect was found
 * and fixed. `latestVintage.intervals` only ever contains rows from the
 * vintage's own generation time forward (`pv-forecast-core.ts`'s
 * `forecastStart = ceilTo15Min(now)` at generation time) — so "sum of
 * every persisted row for today" silently produced a *remaining-from-
 * generation-time* total whenever the latest vintage was generated
 * intraday (true for roughly half of every day, between the two daily
 * scheduler runs), not a genuine full calendar day. Confirmed directly
 * against production data: a live "Daily forecast: 729.9 kWh" for Atlanta
 * was exactly the sum of the 47 persisted rows from 12:15 Sofia
 * (generation time) onward, while the true full-day magnitude (the prior
 * day's vintage, which DID have full midnight-to-midnight coverage for
 * the same date) was ~1088 kWh.
 *
 * The fix is additive, not a redesign of the above: for TODAY only,
 * `dailyForecastKwh`/`dailyPeakKw` (and any of `weeklyForecastKwh`/
 * `monthlyForecastKwh` whose range contains today) become
 * `actual(midnight..now) + remaining-forecast(now..end-of-day)` — the
 * remaining-forecast sum only ever includes rows with
 * `targetIntervalStart >= now`, so there is no overlap with the actual
 * sum by construction, and no double count. This intentionally
 * reintroduces a real-"now"/actual-production dependency, but only for
 * the one case (today) where "the full day" genuinely requires knowing
 * what has already happened — a NON-today day remains exactly as before:
 * a fixed function of the persisted vintage and the selected date alone,
 * completely unaffected by `now` or `todayActualIntervals`.
 *
 * Full-period (Week/Month) semantics fix (Aug 2026): a second, distinct
 * defect from the one above. `latestVintage.intervals` only ever contains
 * rows from the vintage's own `issuedAt` forward — so any day of the
 * selected week/month that is BEFORE today (already elapsed) has no
 * persisted forecast row at all, and (before this fix) no actual-data
 * substitution either, since only today's own contribution was ever
 * corrected. `weeklyForecastKwh`/`monthlyForecastKwh` therefore silently
 * degraded to "remaining forecast from generation time to period end,"
 * not a genuine full-period total — confirmed directly against production
 * data: Chomakovtsi's live `weeklyForecastKwh` read 1,657 kWh while
 * 3,013 kWh had already been produced that same week (the "already
 * elapsed" days simply never appeared in the sum at all), and
 * `monthlyForecastKwh` read 5,831 kWh against 13,562 kWh already
 * produced that month.
 *
 * The fix mirrors the daily fix's own shape rather than inventing a new
 * mechanism: `sumIntervalsInRange` now also accepts `priorDaysActual` —
 * real per-day production totals (reused from the same canonical
 * `PlantDailyKpi`-backed daily totals the KPI cards and the Week/Month
 * actual chart line already fetch, never a second/independent
 * calculation) for every already-elapsed calendar day strictly before
 * today that could fall inside the selected week/month. Any such day's
 * forecast rows (if any happen to exist) are excluded from the
 * forecast-sum exactly the way today's already-elapsed rows already are,
 * so actual and forecast can never double-count for the same day. A
 * period that does not contain today (a genuinely past or future
 * week/month) is completely unaffected — `priorDaysActual` only ever
 * contributes when `includesToday` is true, preserving the "Known scope
 * boundary" behavior for historical date browsing exactly as before.
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

/** `reconstructAvailablePv`'s own native sampling grid (`available-pv-reconstruction.ts`, ADR-007) — used only to convert a 5-minute actual-production energy sample back into an instantaneous kW figure for `dailyPeakKw`, the same conversion `pv-forecast-core.ts`/`calibration.ts` already apply elsewhere against this exact data source. */
const ACTUAL_SAMPLE_MINUTES = 5;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** `YYYY-MM-DD` bucket key for a given instant, in Europe/Sofia. */
function dayBucketKey(instant: Date): string {
  return formatDateInZone(instant, BULGARIA_TIMEZONE);
}

/**
 * Real reconstructed Available PV for TODAY only, from local midnight up
 * to (not including) `now` — a minimal, decoupled shape (not importing
 * `AvailablePvInterval` from `available-pv-reconstruction.ts`, which pulls
 * in Prisma) so this file stays pure/unit-testable. The caller
 * (`dashboard-data.ts`) is the only place that ever calls
 * `reconstructAvailablePv` and maps its result down to this shape.
 */
export type TodayActualInterval = {
  intervalStart: Date;
  availablePvKwh: number | null;
};

function sumActualKwh(intervals: TodayActualInterval[]): number {
  return intervals.reduce((sum, interval) => sum + (interval.availablePvKwh ?? 0), 0);
}

/** `null` when there isn't a single valid sample — never a fabricated 0 kW peak for a day with no real data at all. */
function peakActualKw(intervals: TodayActualInterval[]): number | null {
  const kwValues = intervals
    .filter((interval): interval is TodayActualInterval & { availablePvKwh: number } => interval.availablePvKwh !== null)
    .map((interval) => interval.availablePvKwh / (ACTUAL_SAMPLE_MINUTES / 60));
  return kwValues.length > 0 ? Math.max(...kwValues) : null;
}

/**
 * Full-period (Week/Month) semantics fix. Real, already-known production
 * for one full calendar day strictly before today — a minimal, decoupled
 * shape (matching `TodayActualInterval`'s own precedent) so this file
 * keeps its Prisma-free, unit-testable design. The caller
 * (`dashboard-data.ts`) maps this down from the exact same canonical
 * `PlantDailyKpi`-backed daily totals (`getDailyTotals`) the KPI cards and
 * the Week/Month actual chart line already fetch — never a second,
 * independent production query. `producedKwh: null` (a genuine sync gap)
 * contributes 0, same convention `sumActualKwh` already uses.
 */
export type ElapsedDayActual = {
  /** Any instant within the elapsed local calendar day this total represents — only the local calendar day is read from it. */
  localDate: Date;
  producedKwh: number | null;
};

function sumElapsedDaysKwh(days: ElapsedDayActual[]): number {
  return days.reduce((sum, day) => sum + (day.producedKwh ?? 0), 0);
}

/**
 * The one "actual(midnight..now) + remaining-forecast(now..end-of-day)"
 * combination, shared by `computeForecastSummary`'s `dailyForecastKwh` and
 * `buildDailyForecastBucketMap`'s own today bucket — so the Forecast card
 * and the Week/Month chart's today bar always agree, never two
 * independent calculations of the same full-day figure. `null` only when
 * there is neither a persisted forecast row nor any real actual sample
 * for today at all.
 */
function combineActualAndRemainingKwh(
  todayIntervals: PersistedForecastInterval[],
  now: Date,
  todayActualIntervals: TodayActualInterval[],
): number | null {
  const remainingIntervals = todayIntervals.filter((interval) => interval.targetIntervalStart.getTime() >= now.getTime());
  const actualKwh = sumActualKwh(todayActualIntervals);
  const remainingKwh = remainingIntervals.reduce((sum, interval) => sum + interval.forecastKwh, 0);
  const hasAnyData = todayActualIntervals.length > 0 || todayIntervals.length > 0;
  return hasAnyData ? round2(actualKwh + remainingKwh) : null;
}

/**
 * The compact forecast summary rendered inside the Forecast card. Every
 * figure is a deterministic sum/max over the persisted vintage's own rows
 * for the SELECTED local calendar day/week/month, PLUS — only when the
 * selected day is genuinely today — real actual production for today's
 * already-elapsed hours (see this module's own top doc comment for the
 * full-day semantics fix). `null` only when the current persisted vintage
 * genuinely has no rows covering that window AND (for today) no actual
 * data exists either — never a fabricated zero.
 *
 * - `dailyForecastKwh`: total expected PV energy for the entire selected
 *   local calendar day. For any day other than today: every persisted
 *   interval whose `targetIntervalStart` falls in that day, summed, full
 *   stop (unchanged from before this fix). For today: real actual
 *   production from local midnight to `now`, plus every persisted
 *   interval for today with `targetIntervalStart >= now` (the genuinely
 *   remaining portion) — overlap-free by construction.
 * - `dailyPeakKw`: maximum PV power across that SAME full day (never
 *   "remaining hours only") — for today, the max of the real actual peak
 *   so far and the remaining forecast's own peak.
 * - `weeklyForecastKwh`: the ISO Mon-Sun calendar week containing the
 *   selected date — the exact same 7 days the toolbar's own "Week" period
 *   and chart use (`localWeekBoundsUtc`) — with the same today-correction
 *   applied to today's own contribution, if today falls within that week.
 * - `monthlyForecastKwh`: the entire calendar month containing the selected
 *   date (`localMonthBoundsUtc`), same bounds the Month chart itself uses,
 *   with the same today-correction where applicable.
 * - `confidence`: the selected day's own first REMAINING interval's
 *   confidence label (see `lib/forecast/forecast-tiers.ts`) — `null` when
 *   the day has no persisted intervals left to be confident about (e.g.
 *   very late in the day, or a day with no persisted forecast at all).
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

/**
 * Sums a persisted vintage's `forecastKwh` over intervals whose
 * `targetIntervalStart` falls in `[start, end)`, applying the same
 * actual-production correction `computeForecastSummary`'s own
 * `dailyForecastKwh` uses, extended to the whole selected period: today's
 * rows before `now` are excluded (represented by `todayActualIntervals`
 * instead), and every already-elapsed day strictly before today that
 * falls in range is likewise excluded from the forecast-sum and
 * represented by its own entry in `priorDaysActual` instead — each day
 * contributes exactly once, either as forecast or as actual, never both,
 * never neither. `null` only when there is neither persisted forecast
 * data nor any actual data anywhere in the range.
 */
function sumIntervalsInRange(
  intervals: PersistedForecastInterval[],
  start: Date,
  end: Date,
  now: Date,
  todayActualIntervals: TodayActualInterval[],
  priorDaysActual: ElapsedDayActual[],
): number | null {
  const matching = intervals.filter(
    (interval) => interval.targetIntervalStart.getTime() >= start.getTime() && interval.targetIntervalStart.getTime() < end.getTime(),
  );

  // `priorDaysActual` only ever applies to a period that genuinely contains
  // "now" — a fully past or future selected week/month gets none of this,
  // preserving the pre-existing "Known scope boundary" behavior exactly
  // (see this file's own top doc comment) regardless of what a caller
  // happens to pass for `priorDaysActual`.
  const includesToday = now.getTime() >= start.getTime() && now.getTime() < end.getTime();
  const relevantPriorDays = includesToday
    ? priorDaysActual.filter(
        (day) => day.localDate.getTime() >= start.getTime() && day.localDate.getTime() < end.getTime(),
      )
    : [];
  const elapsedPriorDayKeys = new Set(relevantPriorDays.map((day) => dayBucketKey(day.localDate)));
  const todayKey = dayBucketKey(now);

  const adjusted = matching.filter((interval) => {
    const key = dayBucketKey(interval.targetIntervalStart);
    if (key === todayKey) {
      return interval.targetIntervalStart.getTime() >= now.getTime();
    }
    return !elapsedPriorDayKeys.has(key);
  });

  const actualContribution = round2(
    (includesToday ? sumActualKwh(todayActualIntervals) : 0) + sumElapsedDaysKwh(relevantPriorDays),
  );

  if (adjusted.length === 0 && actualContribution === 0) {
    return null;
  }
  return round2(adjusted.reduce((sum, interval) => sum + interval.forecastKwh, 0) + actualContribution);
}

/**
 * Groups the persisted forecast vintage's intervals into the exact same
 * Sofia-local calendar-day buckets `buildPeriodChartSeries` uses
 * (`bucketKey`), summing each day's `forecastKwh` (never `forecastKw` — a
 * day total is a sum of energy, not power) into one per-day total, for
 * every persisted interval within `[periodStart, periodEnd)`. A day with
 * no persisted forecast rows at all (e.g. a past day the current vintage's
 * forward-looking horizon never covered) simply has no entry in the
 * returned map — UNLESS it's today (see below).
 *
 * Week/Month chart continuity fix (Aug 2026): today's bucket now gets the
 * exact same `actual(midnight..now) + remaining-forecast(now..end-of-day)`
 * correction `computeForecastSummary`'s own `dailyForecastKwh` already
 * uses (via the shared `combineActualAndRemainingKwh` helper — one
 * calculation, two consumers, never a second independent one). Before
 * this fix, today's bucket was a raw sum of whatever forecast rows
 * happened to be persisted for today — which, since a vintage only ever
 * contains rows from its own generation time forward, is a partial-day
 * total that lands close to the actual line's own partial "so far" value
 * for unrelated reasons, then jumps sharply to tomorrow's genuine full-day
 * forecast. That visual "drop then jump" was never tomorrow's forecast
 * being derived from today's incomplete actual — `latestVintage`'s rows
 * for tomorrow and beyond are, and remain, entirely independent of
 * today's actual production — it was today's OWN bucket being
 * artificially low. Fixing today's bucket removes the discontinuity;
 * tomorrow's bucket (and every day after it) is untouched by this fix.
 */
export function buildDailyForecastBucketMap(
  intervals: PersistedForecastInterval[],
  periodStart: Date,
  periodEnd: Date,
  now: Date,
  todayActualIntervals: TodayActualInterval[],
): Map<number, number> {
  const kwhByDayKey = new Map<string, number>();
  const instantByDayKey = new Map<string, number>();
  const todayIntervals: PersistedForecastInterval[] = [];
  const todayKey = dayBucketKey(now);

  for (const interval of intervals) {
    if (
      interval.targetIntervalStart.getTime() < periodStart.getTime() ||
      interval.targetIntervalStart.getTime() >= periodEnd.getTime()
    ) {
      continue;
    }
    const key = dayBucketKey(interval.targetIntervalStart);
    if (!instantByDayKey.has(key)) {
      instantByDayKey.set(key, localDayBoundsUtc(interval.targetIntervalStart, BULGARIA_TIMEZONE).start.getTime());
    }
    if (key === todayKey) {
      // Held aside, not summed directly — today's bucket is computed below
      // via the same actual+remaining combination every other "today"
      // figure on this page uses, never a raw sum of persisted rows.
      todayIntervals.push(interval);
      continue;
    }
    kwhByDayKey.set(key, (kwhByDayKey.get(key) ?? 0) + interval.forecastKwh);
  }

  const result = new Map<number, number>();
  for (const [key, kwh] of kwhByDayKey) {
    result.set(instantByDayKey.get(key) as number, round2(kwh));
  }

  const todayFallsInRange = now.getTime() >= periodStart.getTime() && now.getTime() < periodEnd.getTime();
  if (todayFallsInRange) {
    const todayFullDayKwh = combineActualAndRemainingKwh(todayIntervals, now, todayActualIntervals);
    if (todayFullDayKwh !== null) {
      const todayInstant = instantByDayKey.get(todayKey) ?? localDayBoundsUtc(now, BULGARIA_TIMEZONE).start.getTime();
      result.set(todayInstant, todayFullDayKwh);
    }
  }

  return result;
}

/**
 * Computes the forecast summary for the selected date. Non-today days are
 * a fixed, deterministic function of the persisted vintage and the
 * selected date alone (see this module's own top doc comment); today
 * additionally combines real actual production with the genuinely
 * remaining forecast, overlap-free.
 */
export function computeForecastSummary(params: {
  /** Any instant within the selected local calendar day — this function derives day/week/month bounds from it via `localDayBoundsUtc`/`localWeekBoundsUtc`/`localMonthBoundsUtc`, exactly like `dashboard-data.ts`'s own `referenceInstant`. */
  selectedDate: Date;
  latestVintage: LatestForecastVintage;
  /** Real "now" — used only to decide whether the selected date IS today, and (when it is) where the actual/remaining-forecast boundary falls. Has zero effect on any non-today selected date. */
  now: Date;
  /** Real reconstructed Available PV from local midnight to `now`, for TODAY only. Always safe to pass `[]` (e.g. on a fetch failure) — degrades gracefully to the remaining-forecast-only figure rather than throwing or fabricating a number; ignored entirely when `selectedDate` isn't today. */
  todayActualIntervals: TodayActualInterval[];
  /** Full-period semantics fix: real per-day production for every already-elapsed calendar day strictly before today that could fall inside the selected week/month (see `sumIntervalsInRange`'s own doc comment). Always safe to pass `[]` — degrades to the pre-fix remaining-only figure for those days rather than throwing; only ever consulted for a week/month that genuinely contains today. */
  priorDaysActual: ElapsedDayActual[];
}): ForecastSummary {
  const { selectedDate, latestVintage, now, todayActualIntervals, priorDaysActual } = params;

  const dayBounds = localDayBoundsUtc(selectedDate, BULGARIA_TIMEZONE);
  const weekBounds = localWeekBoundsUtc(selectedDate, BULGARIA_TIMEZONE);
  const monthBounds = localMonthBoundsUtc(selectedDate, BULGARIA_TIMEZONE);

  const dayIntervals = latestVintage.intervals.filter(
    (interval) =>
      interval.targetIntervalStart.getTime() >= dayBounds.start.getTime() &&
      interval.targetIntervalStart.getTime() < dayBounds.end.getTime(),
  );

  const isSelectedDateToday = dayBucketKey(selectedDate) === dayBucketKey(now);

  let dailyForecastKwh: number | null;
  let dailyPeakKw: number | null;
  let confidence: ForecastConfidence | null;

  if (isSelectedDateToday) {
    const remainingIntervals = dayIntervals.filter((interval) => interval.targetIntervalStart.getTime() >= now.getTime());
    dailyForecastKwh = combineActualAndRemainingKwh(dayIntervals, now, todayActualIntervals);

    const actualPeak = peakActualKw(todayActualIntervals);
    const remainingPeakKw = remainingIntervals.length > 0 ? Math.max(...remainingIntervals.map((interval) => interval.forecastKw)) : null;
    dailyPeakKw = actualPeak !== null && remainingPeakKw !== null ? Math.max(actualPeak, remainingPeakKw) : (actualPeak ?? remainingPeakKw);

    confidence = remainingIntervals[0]?.confidence ?? null;
  } else {
    dailyForecastKwh = dayIntervals.length > 0 ? round2(dayIntervals.reduce((sum, interval) => sum + interval.forecastKwh, 0)) : null;
    dailyPeakKw = dayIntervals.length > 0 ? Math.max(...dayIntervals.map((interval) => interval.forecastKw)) : null;
    confidence = dayIntervals[0]?.confidence ?? null;
  }

  const weeklyForecastKwh = sumIntervalsInRange(latestVintage.intervals, weekBounds.start, weekBounds.end, now, todayActualIntervals, priorDaysActual);
  const monthlyForecastKwh = sumIntervalsInRange(latestVintage.intervals, monthBounds.start, monthBounds.end, now, todayActualIntervals, priorDaysActual);

  return {
    dailyForecastKwh,
    dailyPeakKw,
    weeklyForecastKwh,
    monthlyForecastKwh,
    confidence,
    modelVersion: latestVintage.modelVersion,
    weatherSource: latestVintage.weatherSource,
    issuedAt: latestVintage.issuedAt,
  };
}
