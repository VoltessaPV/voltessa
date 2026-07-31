/**
 * ENTSO-E's day-ahead auction "market day" is anchored to CET/CEST
 * (Central European Time) for every bidding zone, not each zone's own
 * civil timezone. Confirmed empirically while building this importer: a
 * request for Bulgaria (whose own civil timezone is Europe/Sofia,
 * EET/EEST) returns `Publication_MarketDocument` `Period.timeInterval`
 * boundaries at 22:00Z/23:00Z (CEST/CET midnight) — not at Bulgaria's own
 * local midnight. Using "Europe/Brussels" (ENTSO-E is headquartered in
 * Brussels; same civil DST rules as the rest of CET) as the reference
 * timezone here is what makes a single requested day map to exactly one
 * `TimeSeries`/`Period` in the response, instead of splitting across two.
 *
 * Implemented with only `Intl.DateTimeFormat` (no date/timezone library,
 * per this project's "simplicity beats cleverness" principle) using the
 * standard "format a UTC guess in the target zone, diff against the
 * result" trick. This correctly handles DST because `Intl` resolves the
 * true local offset for a given UTC instant from the IANA tz database —
 * a local day can be 23, 24, or 25 hours long around EU DST transitions.
 */

export const ENTSOE_MARKET_TIMEZONE = "Europe/Brussels";

function offsetMillisAt(utcMillis: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = Object.fromEntries(
    dtf.formatToParts(new Date(utcMillis)).map((part) => [part.type, part.value]),
  );

  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );

  return asIfUtc - utcMillis;
}

function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const offset = offsetMillisAt(utcGuess, timeZone);

  return new Date(utcGuess - offset);
}

function dateParts(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = Object.fromEntries(
    dtf.formatToParts(instant).map((part) => [part.type, part.value]),
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

/** Formats an instant as its local calendar date (`YYYY-MM-DD`) in `timeZone`. */
export function formatDateInZone(instant: Date, timeZone: string): string {
  const { year, month, day } = dateParts(instant, timeZone);
  const pad = (value: number) => value.toString().padStart(2, "0");

  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Returns the `[start, end)` UTC instants for one calendar day in
 * `timeZone`, correctly handling DST (a local day can be 23, 24, or 25
 * hours long).
 */
export function localDayBoundsUtc(
  referenceInstant: Date,
  timeZone: string,
): { start: Date; end: Date } {
  const { year, month, day } = dateParts(referenceInstant, timeZone);
  const start = zonedTimeToUtc(year, month, day, 0, 0, timeZone);

  // Deriving "the next calendar day" from a nominal +24h jump is always
  // safe (no DST shift is anywhere near 24h); its own local midnight is
  // then computed independently so the DST transition (if any) is
  // handled correctly regardless of which side of it `start` falls on.
  const nextDayGuess = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const nextDayParts = dateParts(nextDayGuess, timeZone);
  const end = zonedTimeToUtc(
    nextDayParts.year,
    nextDayParts.month,
    nextDayParts.day,
    0,
    0,
    timeZone,
  );

  return { start, end };
}

/**
 * Dashboard & Market Analytics milestone. Calendar periods only, never a
 * rolling window: "week" is always Monday 00:00 -> the following Monday
 * 00:00, "month" is always the 1st -> the 1st of the next month, "year" is
 * always Jan 1 -> Jan 1 of the next year - in `timeZone`, DST-safe, same
 * `Intl.DateTimeFormat` technique as `localDayBoundsUtc` above.
 */
export type CalendarPeriod = "today" | "week" | "month" | "year";

/**
 * Returns the `[start, end)` UTC instants for the calendar week (Monday
 * 00:00 through the following Monday 00:00) containing `referenceInstant`,
 * in `timeZone`.
 */
export function localWeekBoundsUtc(
  referenceInstant: Date,
  timeZone: string,
): { start: Date; end: Date } {
  const { year, month, day } = dateParts(referenceInstant, timeZone);

  // Day-of-week is a pure calendar-date property, so this needs no further
  // timezone conversion - anchoring to UTC noon of that same date avoids
  // any local-time DST edge case in `Date`'s own getters.
  const anchor = new Date(Date.UTC(year, month - 1, day, 12));
  const isoWeekday = ((anchor.getUTCDay() + 6) % 7) + 1; // Mon=1 ... Sun=7
  const daysSinceMonday = isoWeekday - 1;

  const mondayAnchor = new Date(anchor.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000);
  const start = zonedTimeToUtc(
    mondayAnchor.getUTCFullYear(),
    mondayAnchor.getUTCMonth() + 1,
    mondayAnchor.getUTCDate(),
    0,
    0,
    timeZone,
  );

  // Same "+7 days, then re-derive the real local midnight" technique
  // `localDayBoundsUtc` uses for its own next-day guess - safe here too,
  // since no DST shift is anywhere near 7*24h.
  const nextMondayGuess = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  const nextMondayParts = dateParts(nextMondayGuess, timeZone);
  const end = zonedTimeToUtc(
    nextMondayParts.year,
    nextMondayParts.month,
    nextMondayParts.day,
    0,
    0,
    timeZone,
  );

  return { start, end };
}

/** Returns the `[start, end)` UTC instants for the calendar month containing `referenceInstant`, in `timeZone`. */
export function localMonthBoundsUtc(
  referenceInstant: Date,
  timeZone: string,
): { start: Date; end: Date } {
  const { year, month } = dateParts(referenceInstant, timeZone);
  const start = zonedTimeToUtc(year, month, 1, 0, 0, timeZone);
  const end =
    month === 12
      ? zonedTimeToUtc(year + 1, 1, 1, 0, 0, timeZone)
      : zonedTimeToUtc(year, month + 1, 1, 0, 0, timeZone);

  return { start, end };
}

/** Returns the `[start, end)` UTC instants for the calendar year containing `referenceInstant`, in `timeZone`. */
export function localYearBoundsUtc(
  referenceInstant: Date,
  timeZone: string,
): { start: Date; end: Date } {
  const { year } = dateParts(referenceInstant, timeZone);
  const start = zonedTimeToUtc(year, 1, 1, 0, 0, timeZone);
  const end = zonedTimeToUtc(year + 1, 1, 1, 0, 0, timeZone);

  return { start, end };
}

/** Dispatches to the right calendar-boundary function for a given `CalendarPeriod` - the one place that needs to know all four exist. */
export function periodBoundsUtc(
  period: CalendarPeriod,
  referenceInstant: Date,
  timeZone: string,
): { start: Date; end: Date } {
  switch (period) {
    case "today":
      return localDayBoundsUtc(referenceInstant, timeZone);
    case "week":
      return localWeekBoundsUtc(referenceInstant, timeZone);
    case "month":
      return localMonthBoundsUtc(referenceInstant, timeZone);
    case "year":
      return localYearBoundsUtc(referenceInstant, timeZone);
  }
}

/**
 * Returns the `[start, end)` bounds of the calendar period immediately
 * preceding the one starting at `currentPeriodStart` - "this week vs.
 * previous calendar week", "this month vs. previous calendar month", etc.,
 * never a rolling window. Every calendar period is at least one full day
 * long and starts exactly at a local-midnight boundary, so 1ms before that
 * boundary is always a genuine instant inside the previous period of the
 * same kind - re-deriving through `periodBoundsUtc` (rather than doing
 * millisecond arithmetic on the boundary itself) is what keeps this correct
 * across DST transitions and variable month/year lengths.
 */
export function previousPeriodBoundsUtc(
  period: CalendarPeriod,
  currentPeriodStart: Date,
  timeZone: string,
): { start: Date; end: Date } {
  const instantInPreviousPeriod = new Date(currentPeriodStart.getTime() - 1);
  return periodBoundsUtc(period, instantInPreviousPeriod, timeZone);
}

/**
 * A short, human-readable label for the selected calendar period - "31 Jul
 * 2026" (today), "28 Jul – 3 Aug 2026" (week), "July 2026" (month), "2026"
 * (year). `en-GB`/`timeZone` hardcoded to match every other date/time label
 * already rendered on Dashboard/Market (e.g. `sofiaDateTimeLabel` in both
 * pages' own `page.tsx`) - this is a value-formatting detail, not
 * UI copy, so it stays outside next-intl exactly like those do.
 */
export function formatPeriodRangeLabel(
  period: CalendarPeriod,
  start: Date,
  end: Date,
  timeZone: string,
): string {
  const lastInstantInPeriod = new Date(end.getTime() - 1);

  if (period === "today") {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(start);
  }

  if (period === "week") {
    const startLabel = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "numeric",
      month: "short",
    }).format(start);
    const endLabel = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(lastInstantInPeriod);

    return `${startLabel} – ${endLabel}`;
  }

  if (period === "month") {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      month: "long",
      year: "numeric",
    }).format(start);
  }

  return new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric" }).format(start);
}
