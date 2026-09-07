import assert from "node:assert/strict";
import { test } from "node:test";

import type { RunStatus } from "@prisma/client";

import type { ExportMode } from "./export-decision";
import {
  aggregateMorningReconciliationStatus,
  runAtlantaMorningReconciliation,
  type MorningReconciliationOrgResult,
  type ReconciliationAttemptStore,
} from "./reconciliation-retry";
import { reconciliationSlotsForDate } from "./reconciliation-retry-schedule";

const ORG = "atlanta-org";
// A Europe/Sofia summer morning; slots are 03:00/03:15/03:30/03:45/04:00 UTC.
const SLOTS = reconciliationSlotsForDate(new Date("2026-08-15T12:00:00Z"));
const slotTime = (i: number) => new Date(SLOTS[i]!.getTime());

/**
 * In-memory ReconciliationAttemptStore modelling the atomic conditional
 * UPDATEs the Prisma binding uses (check-and-set with no await in the
 * critical section == one SQL statement).
 */
function inMemoryStore(initial: Partial<Row> = {}) {
  type RowT = Row;
  const row: RowT = {
    lastDispatchedSlot: -1,
    completedAttempts: 0,
    succeeded: false,
    succeededAt: null,
    finalFailureNotifiedAt: null,
    lastFailureReason: null,
    lastAttemptAt: null,
    ...initial,
  };

  const store: ReconciliationAttemptStore = {
    async loadOrCreate() {
      return {
        lastDispatchedSlot: row.lastDispatchedSlot,
        completedAttempts: row.completedAttempts,
        succeeded: row.succeeded,
        finalFailureNotifiedAt: row.finalFailureNotifiedAt,
        lastFailureReason: row.lastFailureReason,
      };
    },
    async claimSlot(_o, _d, slotIndex, now) {
      if (row.succeeded || row.lastDispatchedSlot >= slotIndex) return false;
      row.lastDispatchedSlot = slotIndex;
      row.lastAttemptAt = now;
      return true;
    },
    async markSucceeded(_o, _d, now) {
      row.succeeded = true;
      row.succeededAt = now;
      row.completedAttempts += 1;
      row.lastFailureReason = null;
    },
    async recordCompletedFailure(_o, _d, reason) {
      if (row.succeeded) return;
      row.completedAttempts += 1;
      row.lastFailureReason = reason;
    },
    async recordLockSkipped(_o, _d, reason) {
      if (row.succeeded) return;
      row.lastFailureReason = reason;
    },
    async claimFinalFailureNotification(_o, _d, now) {
      if (row.succeeded || row.finalFailureNotifiedAt) return false;
      row.finalFailureNotifiedAt = now;
      return true;
    },
  };

  return { row, store };
}

type Row = {
  lastDispatchedSlot: number;
  completedAttempts: number;
  succeeded: boolean;
  succeededAt: Date | null;
  finalFailureNotifiedAt: Date | null;
  lastFailureReason: string | null;
  lastAttemptAt: Date | null;
};

function harness(opts: {
  store: ReconciliationAttemptStore;
  statuses: RunStatus[] | (() => RunStatus);
}) {
  const runOneCalls: string[] = [];
  const notifications: Array<{ organizationId: string; storedMode: ExportMode | null; reason: string }> = [];
  let i = 0;

  return {
    runOneCalls,
    notifications,
    overrides: {
      findOrganizations: async () => [ORG],
      store: opts.store,
      runOneReconciliation: async (organizationId: string) => {
        runOneCalls.push(organizationId);
        return typeof opts.statuses === "function" ? opts.statuses() : opts.statuses[i++]!;
      },
      getStoredMode: async (): Promise<ExportMode | null> => "Zero Export",
      sendFinalFailureNotification: async (
        organizationId: string,
        storedMode: ExportMode | null,
        reason: string,
      ) => {
        notifications.push({ organizationId, storedMode, reason });
      },
    },
  };
}

// --- A: 06:00 succeeds -> no retry -----------------------------------------

test("A. 06:00 attempt succeeds -> attempt row marked succeeded, no notification, and a later invocation is a no-op", async () => {
  const { row, store } = inMemoryStore();
  const h = harness({ store, statuses: () => "SUCCESS" });

  const r1 = await runAtlantaMorningReconciliation({ ...h.overrides, now: slotTime(0) });
  assert.deepEqual(r1, [
    { organizationId: ORG, action: "attempted", slotIndex: 0, isFinalSlot: false, status: "SUCCESS" },
  ]);
  assert.equal(row.succeeded, true);
  assert.equal(h.notifications.length, 0);

  // 06:15 invocation: nothing to do.
  const r2 = await runAtlantaMorningReconciliation({ ...h.overrides, now: slotTime(1) });
  assert.deepEqual(r2, [{ organizationId: ORG, action: "skip", reason: "already_succeeded" }]);
  assert.equal(h.runOneCalls.length, 1);
});

// --- B..E: progressive retries ------------------------------------------

test("B/C/D/E. each failed slot advances to the next 15-minute retry; the 07:00 slot is the final one", async () => {
  const { row, store } = inMemoryStore();
  const h = harness({ store, statuses: () => "FAILED" });

  for (let slot = 0; slot < 5; slot += 1) {
    const results = await runAtlantaMorningReconciliation({ ...h.overrides, now: slotTime(slot) });
    const attempt = results.find((r) => r.action === "attempted") as Extract<
      MorningReconciliationOrgResult,
      { action: "attempted" }
    > | undefined;

    if (slot < 4) {
      assert.ok(attempt, `slot ${slot} should have dispatched an attempt`);
      assert.equal(attempt!.slotIndex, slot);
      assert.equal(attempt!.isFinalSlot, false);
      assert.equal(row.lastDispatchedSlot, slot);
      assert.equal(h.notifications.length, 0, `no notification before the final slot (slot ${slot})`);
    }
  }

  // slot 4 (07:00) failed -> final failure
  assert.equal(row.lastDispatchedSlot, 4);
  assert.equal(row.completedAttempts, 5);
  assert.equal(h.runOneCalls.length, 5);
});

// --- F: 07:00 succeeds -> no failure notification ----------------------

test("F. the final (07:00) attempt succeeds after earlier failures -> no failure notification", async () => {
  const { row, store } = inMemoryStore({ lastDispatchedSlot: 3, completedAttempts: 4 });
  const h = harness({ store, statuses: () => "SUCCESS" });

  const results = await runAtlantaMorningReconciliation({ ...h.overrides, now: slotTime(4) });

  assert.deepEqual(results, [
    { organizationId: ORG, action: "attempted", slotIndex: 4, isFinalSlot: true, status: "SUCCESS" },
  ]);
  assert.equal(row.succeeded, true);
  assert.equal(row.finalFailureNotifiedAt, null);
  assert.equal(h.notifications.length, 0);
});

// --- G: all five fail -> exactly ONE Atlanta notification -------------

test("G. all five attempts fail -> exactly one final-failure notification, even across extra invocations", async () => {
  const { row, store } = inMemoryStore();
  const h = harness({ store, statuses: () => "FAILED" });

  for (let slot = 0; slot < 5; slot += 1) {
    await runAtlantaMorningReconciliation({ ...h.overrides, now: slotTime(slot) });
  }
  assert.equal(h.notifications.length, 1);
  assert.equal(h.notifications[0]!.organizationId, ORG);
  assert.equal(h.notifications[0]!.storedMode, "Zero Export");

  // A stray extra invocation still inside the 07:00 slot, and another after the window.
  await runAtlantaMorningReconciliation({ ...h.overrides, now: new Date(slotTime(4).getTime() + 60_000) });
  await runAtlantaMorningReconciliation({ ...h.overrides, now: new Date(slotTime(4).getTime() + 20 * 60_000) });
  assert.equal(h.notifications.length, 1, "no duplicate final-failure notification");
  assert.equal(row.finalFailureNotifiedAt !== null, true);
});

test("G. two CONCURRENT invocations of the final slot still send exactly one notification", async () => {
  const { store } = inMemoryStore({ lastDispatchedSlot: 3, completedAttempts: 4 });
  const h = harness({ store, statuses: () => "FAILED" });

  await Promise.all([
    runAtlantaMorningReconciliation({ ...h.overrides, now: slotTime(4) }),
    runAtlantaMorningReconciliation({ ...h.overrides, now: slotTime(4) }),
  ]);

  assert.equal(h.notifications.length, 1);
});

// --- H: concurrent scheduler invocation -> no duplicate attempt -----

test("H. two concurrent invocations for the same slot dispatch exactly one reconciliation attempt", async () => {
  const { store } = inMemoryStore();
  const h = harness({ store, statuses: () => "FAILED" });

  const [a, b] = await Promise.all([
    runAtlantaMorningReconciliation({ ...h.overrides, now: slotTime(0) }),
    runAtlantaMorningReconciliation({ ...h.overrides, now: slotTime(0) }),
  ]);

  assert.equal(h.runOneCalls.length, 1, "runOneReconciliation invoked exactly once");
  const all = [...a, ...b];
  assert.equal(all.filter((r) => r.action === "attempted").length, 1);
  assert.equal(all.filter((r) => r.action === "skip" && r.reason === "slot_claimed_by_another_invocation").length, 1);
});

// --- I: previous attempt still running -> no second concurrent recon --

test("I. a slot whose attempt is lock-skipped (prior attempt still running) does not count as a completed attempt and sends no notification", async () => {
  const { row, store } = inMemoryStore({ lastDispatchedSlot: 0 });
  const h = harness({ store, statuses: () => "SKIPPED" });

  const results = await runAtlantaMorningReconciliation({ ...h.overrides, now: slotTime(1) });

  assert.deepEqual(results, [
    { organizationId: ORG, action: "attempted", slotIndex: 1, isFinalSlot: false, status: "SKIPPED" },
  ]);
  assert.equal(h.runOneCalls.length, 1, "exactly one reconciliation dispatched (no second concurrent run)");
  assert.equal(row.completedAttempts, 0, "a lock-skipped attempt is not a completed verification attempt");
  assert.equal(h.notifications.length, 0);
});

test("I. the FINAL slot being lock-skipped still triggers the one failure notification (could not verify by the deadline)", async () => {
  const { store } = inMemoryStore({ lastDispatchedSlot: 3, completedAttempts: 2, lastFailureReason: "earlier failure" });
  const h = harness({ store, statuses: () => "SKIPPED" });

  await runAtlantaMorningReconciliation({ ...h.overrides, now: slotTime(4) });

  assert.equal(h.notifications.length, 1);
});

// --- J: successful retry synchronizes only from verified actual state ---

test("J. on a successful attempt the orchestrator only marks the attempt row succeeded — it never writes currentExportMode itself (the PR1 verified-sync path owns that)", async () => {
  const { row, store } = inMemoryStore({ lastDispatchedSlot: 1, completedAttempts: 2 });
  // runOneReconciliation is the ONLY thing that can verify & synchronize.
  const h = harness({ store, statuses: () => "SUCCESS" });

  await runAtlantaMorningReconciliation({ ...h.overrides, now: slotTime(2) });

  assert.equal(h.runOneCalls.length, 1);
  assert.equal(row.succeeded, true);
  // No stored-mode mutation from the orchestrator: getStoredMode is only
  // read for the (not sent) notification; there is no setter in the seam set.
  assert.equal(h.notifications.length, 0);
});

// --- K: failed verification -> no mode-changing command --------------

test("K. every failed/skipped verification path sends NO FusionSolar command — the only side effects are the attempt row and (on final) the failure notification", async () => {
  const { store } = inMemoryStore();
  // Mix of FAILED and SKIPPED across the five slots.
  const statuses: RunStatus[] = ["FAILED", "SKIPPED", "FAILED", "SKIPPED", "FAILED"];
  const h = harness({ store, statuses });

  for (let slot = 0; slot < 5; slot += 1) {
    const results = await runAtlantaMorningReconciliation({ ...h.overrides, now: slotTime(slot) });
    // The orchestrator never resolves to a "command" action.
    for (const r of results) {
      assert.ok(["attempted", "skip", "final_failure_notified", "final_failure_already_handled"].includes(r.action));
    }
  }
  // Exactly one notification, and it is the retry-exhausted (read-only) one.
  assert.equal(h.notifications.length, 1);
});

// --- aggregateMorningReconciliationStatus -----------------------------

test("aggregate: a final-failure-notified tick is FAILED", () => {
  assert.equal(
    aggregateMorningReconciliationStatus([{ organizationId: ORG, action: "final_failure_notified" }]).status,
    "FAILED",
  );
});

test("aggregate: a non-final FAILED attempt is FAILED (visible), a lock-skipped-only tick is SKIPPED, a verifying tick is SUCCESS, a no-op tick is SUCCESS", () => {
  assert.equal(
    aggregateMorningReconciliationStatus([
      { organizationId: ORG, action: "attempted", slotIndex: 1, isFinalSlot: false, status: "FAILED" },
    ]).status,
    "FAILED",
  );
  assert.equal(
    aggregateMorningReconciliationStatus([
      { organizationId: ORG, action: "attempted", slotIndex: 1, isFinalSlot: false, status: "SKIPPED" },
    ]).status,
    "SKIPPED",
  );
  assert.equal(
    aggregateMorningReconciliationStatus([
      { organizationId: ORG, action: "attempted", slotIndex: 0, isFinalSlot: false, status: "SUCCESS" },
    ]).status,
    "SUCCESS",
  );
  assert.equal(
    aggregateMorningReconciliationStatus([{ organizationId: ORG, action: "skip", reason: "already_succeeded" }]).status,
    "SUCCESS",
  );
});
