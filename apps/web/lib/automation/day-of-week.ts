import { DayOfWeek } from "@prisma/client";

/**
 * Weekly Day-of-Week Scheduling milestone. Same per-module hardcoded-
 * constant convention every other file in this codebase already follows
 * (WeatherCard.tsx, dashboard-data.ts, market-data.ts, ...) rather than
 * reading `Plant.timezone` — see dashboard-data.ts's own top doc comment
 * for why: keeping every module that needs "the" operational timezone on
 * the same hardcoded zone avoids a latent parallel-implementation risk,
 * versus each independently reading a per-plant-configurable field that
 * could in principle differ.
 */
const BULGARIA_TIMEZONE = "Europe/Sofia";

const WEEKDAY_NAME_TO_DAY_OF_WEEK: Record<string, DayOfWeek> = {
  Monday: DayOfWeek.MONDAY,
  Tuesday: DayOfWeek.TUESDAY,
  Wednesday: DayOfWeek.WEDNESDAY,
  Thursday: DayOfWeek.THURSDAY,
  Friday: DayOfWeek.FRIDAY,
  Saturday: DayOfWeek.SATURDAY,
  Sunday: DayOfWeek.SUNDAY,
};

/**
 * The calendar day-of-week `instant` falls on in `timeZone` — DST-safe via
 * `Intl.DateTimeFormat` (the same technique `lib/market-price/timezone.ts`
 * already uses for calendar-boundary math), never the server/browser's own
 * local timezone and never a fixed UTC offset. `timeZone` defaults to the
 * automation engine's own canonical zone; callers evaluating a plant's
 * automation schedule should not override it — see this file's own
 * `BULGARIA_TIMEZONE` doc comment.
 */
export function currentDayOfWeekInZone(
  instant: Date,
  timeZone: string = BULGARIA_TIMEZONE,
): DayOfWeek {
  const weekdayName = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
  }).format(instant);

  const dayOfWeek = WEEKDAY_NAME_TO_DAY_OF_WEEK[weekdayName];

  if (!dayOfWeek) {
    throw new Error(`Unrecognized weekday "${weekdayName}" for timeZone "${timeZone}"`);
  }

  return dayOfWeek;
}

/**
 * Whether `day` is one of `enabledDays` — trivial, but kept as its own
 * named predicate (rather than an inline `.includes()` at each call site)
 * so the "an automation with no selected days never executes, on any day"
 * property is a single, directly testable statement: an empty array
 * returns `false` for every `DayOfWeek`, with no special-casing required.
 */
export function isDayEnabled(enabledDays: DayOfWeek[], day: DayOfWeek): boolean {
  return enabledDays.includes(day);
}

/** ISO weekday order (Monday first) - the order every "Days of the week" UI/list in this milestone uses. */
export const ALL_DAYS_OF_WEEK: DayOfWeek[] = [
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
  DayOfWeek.SATURDAY,
  DayOfWeek.SUNDAY,
];
