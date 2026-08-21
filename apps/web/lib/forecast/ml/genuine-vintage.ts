import { prisma } from "@/lib/prisma";
import { EXPECTED_PRODUCTION_INTERVALS_PER_DAY, isWithinIngestionWindow } from "@/lib/telemetry/ingestion-window";

/**
 * Continuous Retraining Loop milestone (Aug 2026). The single, canonical
 * definition of a "genuine vintage" — a real forecast that was actually
 * issued in production, at a real near-term (SHORT-tier, <=48h) lead time,
 * and has since been reconciled against real actual production. Used by
 * BOTH `lib/forecast/ml/build-training-dataset.ts` (to pick real training
 * rows over synthetic `RETROSPECTIVE_REPLAY` ones) and
 * `scripts/ml/retrain-and-promote.ts` (to decide whether enough NEW
 * genuine data exists to justify a retraining run) — never two separate
 * definitions of the same concept.
 *
 * ## Fix 1: per-INTERVAL selection, not per-day-row-count
 *
 * The original eligibility check counted ALL reconciled `PvForecastRecord`
 * rows for a calendar day and required exactly 96 (one per 15-minute
 * interval). That check was only ever true in the brief window before the
 * twice-daily `voltessa-forecast-refresh.timer` had run enough times to
 * re-forecast the same future day from multiple issuances — the PERMANENT
 * steady state, not a temporary condition (confirmed: Atlanta's
 * 2026-08-14 alone has 847 reconciled rows from 10 distinct vintages for
 * one calendar day). Fixed per INTERVAL: `selectBestShortTierRowPerInterval`
 * picks, for each 15-minute target interval, the SHORT-tier reconciled row
 * closest to a genuine D+1 (24h) lead time — matching what this project's
 * own `RETROSPECTIVE_REPLAY` SHORT scenario already simulates (`leadDays: 1`
 * in `build-training-dataset.ts`).
 *
 * ## Fix 2: the expected-interval denominator is 64, not 96
 *
 * Voltessa's shared telemetry ingestion window (`lib/telemetry/ingestion-window.ts`)
 * is 06:00–22:00 Europe/Sofia, identical for every plant. PV production is
 * structurally zero outside it, so nighttime telemetry is intentionally
 * never pulled — a deliberate architecture decision, not a data gap.
 * Confirmed directly against production data: Chomakovtsi (a plant that
 * follows this window with no incidental extra syncs) reaches ~61/64
 * (95.3%) of its own intentionally-ingested window on a normal day, while
 * the OLD 96-slot-denominator check compared that same 61 against a full
 * day and rejected it as "63.5% coverage" — penalizing a plant for not
 * having data during hours the system was never designed to collect it.
 * Both `selectBestShortTierRowPerInterval` and `computeGenuineVintageDays`
 * now exclude nighttime intervals entirely — they never count toward OR
 * against completeness, for any plant. There is no plant-specific
 * exception anywhere in this module; the 64-slot window is the same
 * shared architectural fact for every plant.
 */

/** Genuine-D+1 target lead time, in minutes — the real-world analog of the `leadDays: 1` synthetic SHORT scenario. */
export const TARGET_D1_LEAD_MINUTES = 24 * 60;

/**
 * A day qualifies once at least this many of its `EXPECTED_PRODUCTION_INTERVALS_PER_DAY`
 * (64) genuinely-expected interval slots have a SHORT-tier reconciled row —
 * not all 64. Even within the ingestion window, the existing physical
 * reconciliation job (`reconcileForecastActuals` in `forecast-persistence.ts`,
 * its ordering fixed by the companion Reconciliation Backlog Determinism
 * fix, otherwise unmodified) only reconciles what it can within its own
 * rolling 3-day lookback, so a small number of intervals can still
 * legitimately lag by the time a day is evaluated. The completeness ratio
 * is unchanged from before this fix — previously 90/96 (93.75%) against a
 * full day; now the SAME 93.75%, expressed against the true 64-slot
 * expected-production denominator: 64 × 0.9375 = 60 exactly. Confirmed
 * this makes Chomakovtsi's real, typical 61/64 day qualify (61 >= 60),
 * while a day with only 59/64 correctly still does not.
 */
const COMPLETENESS_RATIO = 90 / 96; // = 0.9375 = 15/16 — the exact ratio this project has always used; only the denominator it's applied against has changed.
export const MIN_QUALIFYING_SLOTS_PER_DAY = Math.round(EXPECTED_PRODUCTION_INTERVALS_PER_DAY * COMPLETENESS_RATIO);

type LeadTimeRow = { targetIntervalStart: Date; leadTimeMinutes: number };

/**
 * Per interval, picks the SHORT-tier reconciled row whose `leadTimeMinutes`
 * is closest to a genuine day-ahead (24h) forecast — never an arbitrary
 * "first" or "last" row when several vintages cover the same interval.
 * Rows outside the shared ingestion window (`isWithinIngestionWindow`) are
 * dropped entirely here — nighttime is intentionally never ingested, so a
 * row for one of those intervals should not exist in practice, but this
 * function never relies on that; it enforces the exclusion itself so
 * "genuine vintage" has exactly one definition regardless of what a caller
 * happens to pass in. Pure function, no I/O — the caller fetches rows
 * already filtered to `horizonTier: "SHORT", actualKwh: { not: null }` for
 * one plant/day.
 */
export function selectBestShortTierRowPerInterval<T extends LeadTimeRow>(rows: T[]): T[] {
  const bestByInterval = new Map<number, T>();
  for (const row of rows) {
    if (!isWithinIngestionWindow(row.targetIntervalStart)) {
      continue;
    }
    const key = row.targetIntervalStart.getTime();
    const existing = bestByInterval.get(key);
    if (!existing || Math.abs(row.leadTimeMinutes - TARGET_D1_LEAD_MINUTES) < Math.abs(existing.leadTimeMinutes - TARGET_D1_LEAD_MINUTES)) {
      bestByInterval.set(key, row);
    }
  }
  return [...bestByInterval.values()].sort((a, b) => a.targetIntervalStart.getTime() - b.targetIntervalStart.getTime());
}

/** `YYYY-MM-DD` UTC calendar-day key — matches `export-training-dataset.ts`'s own existing UTC-day convention (`Date.UTC(...)`/`toISOString().slice(0,10)`), not the Sofia-local convention used elsewhere in this codebase (Dashboard/Market). Deliberately NOT reusing `formatDateInZone` here — this module must agree with the exporter it feeds, not with an unrelated page's timezone choice. */
function utcDayKey(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/**
 * Pure: given SHORT-tier, reconciled `{ targetIntervalStart }` rows for one
 * plant (any date range), returns the sorted list of UTC calendar-day keys
 * that qualify as genuine vintage days — at least `MIN_QUALIFYING_SLOTS_PER_DAY`
 * (60) of the day's `EXPECTED_PRODUCTION_INTERVALS_PER_DAY` (64,
 * ingestion-window-only) interval slots have at least one such row. Rows
 * outside the ingestion window are excluded from both the numerator and
 * the denominator — they never count toward OR against completeness, for
 * any plant, identically. A day with 847 rows spanning only 50
 * IN-WINDOW distinct slots does NOT qualify; a day spanning 61 or 64
 * in-window distinct slots does.
 */
export function computeGenuineVintageDays(rows: { targetIntervalStart: Date }[]): string[] {
  const slotsByDay = new Map<string, Set<number>>();
  for (const row of rows) {
    if (!isWithinIngestionWindow(row.targetIntervalStart)) {
      continue;
    }
    const day = utcDayKey(row.targetIntervalStart);
    const slots = slotsByDay.get(day) ?? new Set<number>();
    slots.add(row.targetIntervalStart.getTime());
    slotsByDay.set(day, slots);
  }
  return [...slotsByDay.entries()]
    .filter(([, slots]) => slots.size >= MIN_QUALIFYING_SLOTS_PER_DAY)
    .map(([day]) => day)
    .sort();
}

/**
 * DB-facing wrapper: real genuine vintage days for one plant in
 * `[sinceInclusive, untilExclusive)`. Thin fetch + `computeGenuineVintageDays`
 * — kept separate from the pure function above so the qualification logic
 * itself stays unit-testable without Prisma, matching this codebase's own
 * established pure/DB-facing split (see `forecast-bucket-aggregation.ts`
 * vs. `dashboard-data.ts`).
 */
export async function findGenuineVintageDays(plantId: string, sinceInclusive: Date, untilExclusive: Date): Promise<string[]> {
  const rows = await prisma.pvForecastRecord.findMany({
    where: {
      plantId,
      horizonTier: "SHORT",
      actualKwh: { not: null },
      targetIntervalStart: { gte: sinceInclusive, lt: untilExclusive },
    },
    select: { targetIntervalStart: true },
  });
  return computeGenuineVintageDays(rows);
}

/**
 * Conservative, data-driven retraining gate (Continuous Retraining Loop
 * milestone). Pure decision function — never retrain merely because a
 * schedule fired; only when enough genuinely new evidence exists across
 * ALL plants combined (a global model, so evidence accumulates globally,
 * per ADR-precedent: plant identity is a feature, not a reason to
 * partition training runs). `newVintageDayCountsByPlant` must already be
 * "days since the current champion's own `trainingDataEnd`" per plant —
 * this function only sums and compares against the threshold.
 */
export const MIN_NEW_VINTAGE_DAYS_TO_RETRAIN = 5;

export function shouldRetrain(newVintageDayCountsByPlant: number[], minTotalNewDays: number = MIN_NEW_VINTAGE_DAYS_TO_RETRAIN): boolean {
  const total = newVintageDayCountsByPlant.reduce((sum, n) => sum + n, 0);
  return total >= minTotalNewDays;
}
