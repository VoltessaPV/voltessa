import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decideReconciliationRetry,
  reconciliationSlotsForDate,
  type ReconciliationAttemptState,
} from "./reconciliation-retry-schedule";

// --- reconciliationSlotsForDate (DST-exact) ---------------------------------

test("L. slots are 06:00/06:15/06:30/06:45/07:00 Europe/Sofia — summer (EEST, UTC+3)", () => {
  const slots = reconciliationSlotsForDate(new Date("2026-08-15T12:00:00Z"));
  assert.deepEqual(
    slots.map((s) => s.toISOString()),
    [
      "2026-08-15T03:00:00.000Z",
      "2026-08-15T03:15:00.000Z",
      "2026-08-15T03:30:00.000Z",
      "2026-08-15T03:45:00.000Z",
      "2026-08-15T04:00:00.000Z",
    ],
  );
});

test("L. slots are 06:00..07:00 Europe/Sofia — winter (EET, UTC+2)", () => {
  const slots = reconciliationSlotsForDate(new Date("2026-12-15T12:00:00Z"));
  assert.deepEqual(
    slots.map((s) => s.toISOString()),
    [
      "2026-12-15T04:00:00.000Z",
      "2026-12-15T04:15:00.000Z",
      "2026-12-15T04:30:00.000Z",
      "2026-12-15T04:45:00.000Z",
      "2026-12-15T05:00:00.000Z",
    ],
  );
});

test("L. across the DST fall-back (Sofia 2026-10-25 04:00->03:00), adjacent mornings' 06:00 slot shifts by exactly one hour", () => {
  const beforeFallBack = reconciliationSlotsForDate(new Date("2026-10-24T12:00:00Z"))[0]!;
  const onFallBack = reconciliationSlotsForDate(new Date("2026-10-25T12:00:00Z"))[0]!;
  assert.equal(beforeFallBack.toISOString(), "2026-10-24T03:00:00.000Z"); // still EEST
  assert.equal(onFallBack.toISOString(), "2026-10-25T04:00:00.000Z"); // now EET
});

test("L. the Sofia calendar date is taken from the reference instant, not UTC", () => {
  // 2026-08-14T22:30:00Z is already 2026-08-15 01:30 in Sofia.
  const slots = reconciliationSlotsForDate(new Date("2026-08-14T22:30:00Z"));
  assert.equal(slots[0]!.toISOString(), "2026-08-15T03:00:00.000Z");
});

// --- decideReconciliationRetry (pure) -------------------------------------

/** 5 slots 15 min apart starting at an arbitrary base instant. */
const BASE = new Date("2026-08-15T03:00:00.000Z").getTime();
const SLOTS = [0, 15, 30, 45, 60].map((m) => new Date(BASE + m * 60_000));
const at = (minutesFromBase: number) => new Date(BASE + minutesFromBase * 60_000);

const state = (overrides: Partial<ReconciliationAttemptState> = {}): ReconciliationAttemptState => ({
  lastDispatchedSlot: -1,
  completedAttempts: 0,
  succeeded: false,
  finalFailureNotifiedAt: null,
  lastFailureReason: null,
  ...overrides,
});

test("A. 06:00 with no prior state -> attempt slot 0, not final", () => {
  assert.deepEqual(decideReconciliationRetry({ now: at(0), slots: SLOTS, state: null }), {
    action: "attempt",
    slotIndex: 0,
    isFinalSlot: false,
  });
});

test("A. once an earlier attempt succeeded, every later invocation skips", () => {
  assert.deepEqual(
    decideReconciliationRetry({ now: at(30), slots: SLOTS, state: state({ succeeded: true, lastDispatchedSlot: 0 }) }),
    { action: "skip", reason: "already_succeeded" },
  );
});

test("B. 06:00 failed (lastDispatchedSlot=0), 06:15 -> attempt slot 1", () => {
  assert.deepEqual(
    decideReconciliationRetry({ now: at(15), slots: SLOTS, state: state({ lastDispatchedSlot: 0 }) }),
    { action: "attempt", slotIndex: 1, isFinalSlot: false },
  );
});

test("C. 06:00+06:15 failed, 06:30 -> attempt slot 2", () => {
  assert.deepEqual(
    decideReconciliationRetry({ now: at(30), slots: SLOTS, state: state({ lastDispatchedSlot: 1 }) }),
    { action: "attempt", slotIndex: 2, isFinalSlot: false },
  );
});

test("D. 06:00+06:15+06:30 failed, 06:45 -> attempt slot 3", () => {
  assert.deepEqual(
    decideReconciliationRetry({ now: at(45), slots: SLOTS, state: state({ lastDispatchedSlot: 2 }) }),
    { action: "attempt", slotIndex: 3, isFinalSlot: false },
  );
});

test("E. 06:00..06:45 failed, 07:00 -> attempt slot 4, FINAL", () => {
  assert.deepEqual(
    decideReconciliationRetry({ now: at(60), slots: SLOTS, state: state({ lastDispatchedSlot: 3 }) }),
    { action: "attempt", slotIndex: 4, isFinalSlot: true },
  );
});

test("a second invocation inside the same 15-minute slot is an idempotent no-op", () => {
  assert.deepEqual(
    decideReconciliationRetry({ now: at(18), slots: SLOTS, state: state({ lastDispatchedSlot: 1 }) }),
    { action: "skip", reason: "slot_already_dispatched" },
  );
});

test("a stale/replayed invocation for an earlier slot than the last dispatched one skips", () => {
  assert.deepEqual(
    decideReconciliationRetry({ now: at(30), slots: SLOTS, state: state({ lastDispatchedSlot: 3 }) }),
    { action: "skip", reason: "slot_already_dispatched" },
  );
});

test("before the window (before 06:00) -> skip", () => {
  assert.deepEqual(decideReconciliationRetry({ now: at(-1), slots: SLOTS, state: null }), {
    action: "skip",
    reason: "before_window",
  });
});

test("after the window (07:15 or later) -> skip", () => {
  assert.deepEqual(
    decideReconciliationRetry({ now: at(75), slots: SLOTS, state: state({ lastDispatchedSlot: 4, completedAttempts: 5 }) }),
    { action: "skip", reason: "after_window" },
  );
});

test("the 07:00 slot stays active until 07:15", () => {
  assert.deepEqual(
    decideReconciliationRetry({ now: at(74), slots: SLOTS, state: state({ lastDispatchedSlot: 3 }) }),
    { action: "attempt", slotIndex: 4, isFinalSlot: true },
  );
});

test("if earlier slots were missed entirely (first call at 06:30), attempt runs for slot 2", () => {
  assert.deepEqual(decideReconciliationRetry({ now: at(30), slots: SLOTS, state: null }), {
    action: "attempt",
    slotIndex: 2,
    isFinalSlot: false,
  });
});
