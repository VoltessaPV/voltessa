import { test, expect } from "@playwright/test";
import { DayOfWeek } from "@prisma/client";

import { ALL_DAYS_OF_WEEK, currentDayOfWeekInZone, isDayEnabled } from "@/lib/automation/day-of-week";

/**
 * Weekly Day-of-Week Scheduling milestone.
 *
 * Pure-function tests, no DB/browser/network - see
 * `forecast-bucket-aggregation.spec.ts` for why this suite (not a
 * dedicated unit-test runner, which apps/web doesn't have) hosts these.
 *
 * Covers the two functions that jointly decide whether the Market Price
 * Optimization Execution Engine's `findEligibleOrganizations` includes an
 * organization for "today": `currentDayOfWeekInZone` (which calendar day
 * "today" is, in the automation engine's own Europe/Sofia timezone) and
 * `isDayEnabled` (whether that day is one of the organization's configured
 * `enabledDays`). `findEligibleOrganizations` itself composes these two
 * exact functions into a Prisma `enabledDays: { has: today } ` filter -
 * that composition is not re-tested here (it would need a real database,
 * per docs/TESTING.md's existing scoping for this codebase), but every
 * decision that filter depends on is covered directly below.
 */

const SOFIA = "Europe/Sofia";

// A clean week where the UTC and Sofia calendar dates agree (August 2026,
// Sofia on EEST/UTC+3, well clear of both the Mon-12:00 and Sun-12:00
// edges of that offset).
const MONDAY_2026_08_10 = new Date("2026-08-10T12:00:00Z");
const TUESDAY_2026_08_11 = new Date("2026-08-11T12:00:00Z");
const WEDNESDAY_2026_08_12 = new Date("2026-08-12T12:00:00Z");
const THURSDAY_2026_08_13 = new Date("2026-08-13T12:00:00Z");
const FRIDAY_2026_08_14 = new Date("2026-08-14T12:00:00Z");
const SATURDAY_2026_08_15 = new Date("2026-08-15T12:00:00Z");
const SUNDAY_2026_08_16 = new Date("2026-08-16T12:00:00Z");

const WEEK = {
  MONDAY: MONDAY_2026_08_10,
  TUESDAY: TUESDAY_2026_08_11,
  WEDNESDAY: WEDNESDAY_2026_08_12,
  THURSDAY: THURSDAY_2026_08_13,
  FRIDAY: FRIDAY_2026_08_14,
  SATURDAY: SATURDAY_2026_08_15,
  SUNDAY: SUNDAY_2026_08_16,
} as const satisfies Record<DayOfWeek, Date>;

test.describe("currentDayOfWeekInZone", () => {
  for (const [day, instant] of Object.entries(WEEK) as [DayOfWeek, Date][]) {
    test(`resolves ${day} correctly`, () => {
      expect(currentDayOfWeekInZone(instant, SOFIA)).toBe(day);
    });
  }

  test("uses the operational timezone, not UTC: a UTC-Monday-evening instant is already Tuesday in Sofia", () => {
    const instant = new Date("2026-08-10T23:30:00Z"); // Monday 23:30 UTC == Tuesday 02:30 Sofia (UTC+3 in August)
    expect(currentDayOfWeekInZone(instant, "UTC")).toBe("MONDAY");
    expect(currentDayOfWeekInZone(instant, SOFIA)).toBe("TUESDAY");
  });

  test("defaults to Europe/Sofia when no timeZone is passed - the automation engine's own canonical zone", () => {
    const instant = new Date("2026-08-10T23:30:00Z");
    expect(currentDayOfWeekInZone(instant)).toBe("TUESDAY");
  });

  test("resolves correctly straddling the real Europe/Sofia DST fall-back (2026-10-25, EEST -> EET at 01:00 UTC)", () => {
    // Confirmed elsewhere in this codebase (lib/market-price/timezone.ts) as
    // Sofia's real 2026 fall-back date - clocks move from local 04:00 EEST
    // back to 03:00 EET, both instants still well before local midnight.
    const beforeFallBack = new Date("2026-10-25T00:30:00Z"); // 03:30 EEST
    const afterFallBack = new Date("2026-10-25T01:30:00Z"); // 03:30 EET
    const lateSameSofiaDay = new Date("2026-10-25T21:30:00Z"); // 23:30 EET

    expect(currentDayOfWeekInZone(beforeFallBack, SOFIA)).toBe("SUNDAY");
    expect(currentDayOfWeekInZone(afterFallBack, SOFIA)).toBe("SUNDAY");
    expect(currentDayOfWeekInZone(lateSameSofiaDay, SOFIA)).toBe("SUNDAY");
  });

  test("a UTC-Saturday-night instant is already Sunday in Sofia, the day before that same DST fall-back", () => {
    const instant = new Date("2026-10-24T22:30:00Z"); // Saturday 22:30 UTC == Sunday 01:30 Sofia (still EEST)
    expect(currentDayOfWeekInZone(instant, "UTC")).toBe("SATURDAY");
    expect(currentDayOfWeekInZone(instant, SOFIA)).toBe("SUNDAY");
  });
});

test.describe("isDayEnabled", () => {
  test("Saturday/Sunday only: eligible on Saturday and Sunday, never Monday-Friday", () => {
    const weekendOnly: DayOfWeek[] = ["SATURDAY", "SUNDAY"];

    expect(isDayEnabled(weekendOnly, "SATURDAY")).toBe(true);
    expect(isDayEnabled(weekendOnly, "SUNDAY")).toBe(true);

    for (const weekday of ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] as const) {
      expect(isDayEnabled(weekendOnly, weekday)).toBe(false);
    }
  });

  test("Monday-Friday only: eligible on weekdays, never Saturday/Sunday", () => {
    const weekdaysOnly: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];

    for (const weekday of weekdaysOnly) {
      expect(isDayEnabled(weekdaysOnly, weekday)).toBe(true);
    }

    expect(isDayEnabled(weekdaysOnly, "SATURDAY")).toBe(false);
    expect(isDayEnabled(weekdaysOnly, "SUNDAY")).toBe(false);
  });

  test("a single selected day: eligible only on that exact day", () => {
    const wednesdayOnly: DayOfWeek[] = ["WEDNESDAY"];

    expect(isDayEnabled(wednesdayOnly, "WEDNESDAY")).toBe(true);

    for (const other of ["MONDAY", "TUESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const) {
      expect(isDayEnabled(wednesdayOnly, other)).toBe(false);
    }
  });

  test("all seven days selected: eligible every day", () => {
    for (const day of Object.keys(WEEK) as DayOfWeek[]) {
      expect(isDayEnabled(ALL_DAYS_OF_WEEK, day)).toBe(true);
    }
  });

  test("no days selected: never eligible on any day - the safe default for an inert configuration, not \"every day\"", () => {
    const noDays: DayOfWeek[] = [];

    for (const day of Object.keys(WEEK) as DayOfWeek[]) {
      expect(isDayEnabled(noDays, day)).toBe(false);
    }
  });

  test("existing automations retain their current (always-on) behavior after migration: the schema's ALL_DAYS_OF_WEEK default is eligible every day", () => {
    // AutomationSettings.enabledDays defaults to ALL_DAYS_OF_WEEK
    // (prisma/schema.prisma) - this is the exact value every pre-existing
    // row receives once the column is added, so an automation that was
    // already enabled keeps running on every day it always ran on, with no
    // behavior change until an owner explicitly narrows it.
    expect(ALL_DAYS_OF_WEEK).toHaveLength(7);
    for (const day of ALL_DAYS_OF_WEEK) {
      expect(isDayEnabled(ALL_DAYS_OF_WEEK, day)).toBe(true);
    }
  });
});

test.describe("composed eligibility (mirrors findEligibleOrganizations' own enabledDays filter)", () => {
  /** Same composition `findEligibleOrganizations` expresses as a Prisma `enabledDays: { has: today }` filter - reproduced here purely to assert the AND behavior end to end, without a database. */
  function wouldExecuteToday(
    automationEnabled: boolean,
    enabledDays: DayOfWeek[],
    now: Date,
    timeZone: string,
  ): boolean {
    return automationEnabled && isDayEnabled(enabledDays, currentDayOfWeekInZone(now, timeZone));
  }

  test("Saturday/Sunday only, enabled: executes on Saturday and Sunday, never Monday-Friday", () => {
    const weekendOnly: DayOfWeek[] = ["SATURDAY", "SUNDAY"];

    expect(wouldExecuteToday(true, weekendOnly, WEEK.SATURDAY, SOFIA)).toBe(true);
    expect(wouldExecuteToday(true, weekendOnly, WEEK.SUNDAY, SOFIA)).toBe(true);
    expect(wouldExecuteToday(true, weekendOnly, WEEK.MONDAY, SOFIA)).toBe(false);
    expect(wouldExecuteToday(true, weekendOnly, WEEK.FRIDAY, SOFIA)).toBe(false);
  });

  test("Monday-Friday only, enabled: does not execute on Saturday or Sunday", () => {
    const weekdaysOnly: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];

    expect(wouldExecuteToday(true, weekdaysOnly, WEEK.WEDNESDAY, SOFIA)).toBe(true);
    expect(wouldExecuteToday(true, weekdaysOnly, WEEK.SATURDAY, SOFIA)).toBe(false);
    expect(wouldExecuteToday(true, weekdaysOnly, WEEK.SUNDAY, SOFIA)).toBe(false);
  });

  test("all seven days, enabled: executes every day", () => {
    for (const instant of Object.values(WEEK)) {
      expect(wouldExecuteToday(true, ALL_DAYS_OF_WEEK, instant, SOFIA)).toBe(true);
    }
  });

  test("automation disabled overrides an otherwise-eligible day - the toggle still gates everything", () => {
    expect(wouldExecuteToday(false, ALL_DAYS_OF_WEEK, WEEK.MONDAY, SOFIA)).toBe(false);
  });

  test("enabled with no days selected never executes, on any day of the week", () => {
    for (const instant of Object.values(WEEK)) {
      expect(wouldExecuteToday(true, [], instant, SOFIA)).toBe(false);
    }
  });
});
