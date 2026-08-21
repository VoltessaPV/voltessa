import { prisma } from "@/lib/prisma";

/**
 * Continuous Retraining Loop milestone (Aug 2026). The single, canonical
 * definition of a "genuine vintage" — a real forecast that was actually
 * issued in production, at a real near-term (SHORT-tier, <=48h) lead time,
 * and has since been reconciled against real actual production. Used by
 * BOTH `scripts/ml/export-training-dataset.ts` (to pick real training rows
 * over synthetic `RETROSPECTIVE_REPLAY` ones) and
 * `scripts/ml/retrain-and-promote.ts` (to decide whether enough NEW
 * genuine data exists to justify a retraining run) — never two separate
 * definitions of the same concept.
 *
 * ## The bug this module fixes
 *
 * The exporter's original eligibility check counted ALL reconciled
 * `PvForecastRecord` rows for a calendar day and required exactly 96 (one
 * per 15-minute interval). That check was only ever true in the brief
 * window before the twice-daily `voltessa-forecast-refresh.timer` had run
 * enough times to re-forecast the same future day from multiple
 * issuances — which is the PERMANENT steady state, not a temporary
 * condition. Confirmed directly against production data: Atlanta's
 * 2026-08-14 alone has 847 reconciled rows from 10 distinct vintages for
 * that one calendar day. The exact-96 check has therefore matched ZERO
 * days for either plant since the system reached steady state, and would
 * never match again no matter how long the system runs — every additional
 * refresh cycle only adds MORE overlapping rows to an already-elapsed day,
 * never exactly 96.
 *
 * The fix: per INTERVAL, not per day-row-count. For each 15-minute target
 * interval, multiple SHORT-tier (<=48h lead time) reconciled vintages can
 * legitimately exist (any forecast issued within 48h of that interval
 * qualifies as SHORT) — `selectBestShortTierRowPerInterval` picks the one
 * closest to a genuine D+1 (24h) lead time, matching what this project's
 * own `RETROSPECTIVE_REPLAY` SHORT scenario already simulates
 * (`leadDays: 1` in `export-training-dataset.ts`). A day is genuinely
 * TRUE_VINTAGE only when all 96 interval slots have at least one such row.
 */

/** Genuine-D+1 target lead time, in minutes — the real-world analog of the `leadDays: 1` synthetic SHORT scenario. */
export const TARGET_D1_LEAD_MINUTES = 24 * 60;

/**
 * A day qualifies once at least this many of its 96 interval slots have a
 * SHORT-tier reconciled row — not literally all 96. The existing physical
 * reconciliation job (`reconcileForecastActuals` in `forecast-persistence.ts`,
 * unmodified, out of scope for this milestone) only ever looks at rows
 * within its own rolling 3-day lookback window (`RECONCILE_LOOKBACK_DAYS`)
 * and requires an exact 3-native-sample-per-bucket match; any interval
 * that fails that check within its own 3-day eligibility window is never
 * retried again and stays `actualKwh: null` permanently. Confirmed
 * directly against production data: Atlanta's most recent 4 available
 * days each independently cap out at exactly 93/96, consistently missing
 * the same 3 dusk intervals (20:45–21:15 UTC) every time — a structural
 * property of the existing, out-of-scope reconciliation window, not
 * something this module should paper over by silently redefining
 * "genuine," but also not something worth blocking on requiring
 * mathematical perfection that production will never actually reach. 90
 * (93.75%) keeps a real margin below the observed 93 while still
 * requiring near-complete coverage — a handful of permanently-unreconciled
 * near-zero-production dusk intervals must never disqualify an otherwise
 * genuine day.
 */
export const MIN_QUALIFYING_SLOTS_PER_DAY = 90;

type LeadTimeRow = { targetIntervalStart: Date; leadTimeMinutes: number };

/**
 * Per interval, picks the SHORT-tier reconciled row whose `leadTimeMinutes`
 * is closest to a genuine day-ahead (24h) forecast — never an arbitrary
 * "first" or "last" row when several vintages cover the same interval.
 * Pure function, no I/O — the caller fetches rows already filtered to
 * `horizonTier: "SHORT", actualKwh: { not: null }` for one plant/day.
 */
export function selectBestShortTierRowPerInterval<T extends LeadTimeRow>(rows: T[]): T[] {
  const bestByInterval = new Map<number, T>();
  for (const row of rows) {
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
 * of the day's 96 interval slots have at least one such row (see that
 * constant's own doc comment for why this isn't a literal 96/96). A day
 * with 847 rows spanning only 50 distinct slots does NOT qualify; a day
 * spanning 93 or 96 distinct slots does.
 */
export function computeGenuineVintageDays(rows: { targetIntervalStart: Date }[]): string[] {
  const slotsByDay = new Map<string, Set<number>>();
  for (const row of rows) {
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
