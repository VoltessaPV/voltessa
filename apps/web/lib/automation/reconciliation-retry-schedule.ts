import { formatDateInZone, zonedTimeToUtc } from "@/lib/market-price/timezone";

/**
 * Atlanta morning-reconciliation retry schedule (Atlanta Automation
 * incident remediation, "reconciliation retry" change).
 *
 * The reconciliation route is invoked at each of these Europe/Sofia
 * wall-clock times every morning — the systemd timer's `OnCalendar` fires
 * five times, and the route decides per invocation whether this slot needs
 * a (re)try (see `decideReconciliationRetry` and
 * `lib/automation/reconciliation-retry.ts`). NOT an in-memory timer: nothing
 * is scheduled with `setTimeout`/`setInterval`; each attempt is a separate
 * serverless invocation whose eligibility is derived from persisted state
 * plus the current clock.
 *
 *   slot 0 — 06:00  initial attempt
 *   slot 1 — 06:15  retry #1 (only if slot 0 did not verify)
 *   slot 2 — 06:30  retry #2
 *   slot 3 — 06:45  retry #3
 *   slot 4 — 07:00  final retry #4 — failure here triggers the one alert
 */
export const ATLANTA_RECONCILIATION_SCHEDULE = {
  timeZone: "Europe/Sofia",
  firstSlotHour: 6,
  firstSlotMinute: 0,
  intervalMinutes: 15,
  slotCount: 5,
} as const;

export type ReconciliationSchedule = typeof ATLANTA_RECONCILIATION_SCHEDULE;

/**
 * The `slotCount` slot instants (UTC `Date`s) for the `timeZone` calendar
 * date that `reference` falls on. DST-exact: each slot is computed as
 * "HH:MM on that local calendar date" via `zonedTimeToUtc`, never
 * `midnight + N hours` (which is wrong on the two DST-transition days). The
 * 06:00–07:00 window never overlaps Sofia's 03:00/04:00 DST transitions, so
 * every slot is an unambiguous local time.
 */
export function reconciliationSlotsForDate(
  reference: Date,
  schedule: ReconciliationSchedule = ATLANTA_RECONCILIATION_SCHEDULE,
): Date[] {
  const [year, month, day] = formatDateInZone(reference, schedule.timeZone)
    .split("-")
    .map(Number) as [number, number, number];
  const slots: Date[] = [];

  for (let index = 0; index < schedule.slotCount; index += 1) {
    const totalMinutes =
      schedule.firstSlotHour * 60 + schedule.firstSlotMinute + index * schedule.intervalMinutes;
    const hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;

    slots.push(zonedTimeToUtc(year, month, day, hour, minute, schedule.timeZone));
  }

  return slots;
}

/** The persisted per-morning state `decideReconciliationRetry` reads — a subset of `AutomationReconciliationAttempt`. */
export type ReconciliationAttemptState = {
  lastDispatchedSlot: number;
  completedAttempts: number;
  succeeded: boolean;
  finalFailureNotifiedAt: Date | null;
  lastFailureReason: string | null;
};

export type RetryDecision =
  | { action: "attempt"; slotIndex: number; isFinalSlot: boolean }
  | {
      action: "skip";
      reason: "before_window" | "after_window" | "already_succeeded" | "slot_already_dispatched";
    };

/**
 * Pure. Given the clock, today's slot instants, and the persisted state,
 * decides whether THIS invocation should dispatch a reconciliation attempt.
 *
 * - `already_succeeded` — an earlier attempt this morning verified the real
 *   FusionSolar state; stop retrying.
 * - `before_window` / `after_window` — the invocation landed outside
 *   06:00–07:15 Sofia; do nothing.
 * - `slot_already_dispatched` — a run has already been dispatched for this
 *   15-minute slot (or a later one); idempotent no-op.
 * - `attempt` — dispatch a verification attempt for `slotIndex`;
 *   `isFinalSlot` marks the 07:00 slot, whose failure triggers the single
 *   final-failure notification.
 */
export function decideReconciliationRetry(input: {
  now: Date;
  slots: Date[];
  state: ReconciliationAttemptState | null;
}): RetryDecision {
  const { now, slots, state } = input;

  if (state?.succeeded) {
    return { action: "skip", reason: "already_succeeded" };
  }

  if (slots.length === 0) {
    return { action: "skip", reason: "after_window" };
  }

  const intervalMs =
    slots.length >= 2
      ? slots[1]!.getTime() - slots[0]!.getTime()
      : ATLANTA_RECONCILIATION_SCHEDULE.intervalMinutes * 60 * 1000;

  const nowMs = now.getTime();

  if (nowMs < slots[0]!.getTime()) {
    return { action: "skip", reason: "before_window" };
  }

  const windowEndMs = slots[slots.length - 1]!.getTime() + intervalMs;

  if (nowMs >= windowEndMs) {
    return { action: "skip", reason: "after_window" };
  }

  let slotIndex = 0;
  for (let index = 0; index < slots.length; index += 1) {
    if (nowMs >= slots[index]!.getTime()) {
      slotIndex = index;
    }
  }

  if (state && state.lastDispatchedSlot >= slotIndex) {
    return { action: "skip", reason: "slot_already_dispatched" };
  }

  return { action: "attempt", slotIndex, isFinalSlot: slotIndex === slots.length - 1 };
}
