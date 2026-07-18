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
