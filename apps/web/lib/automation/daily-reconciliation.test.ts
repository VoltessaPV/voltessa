import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RECONCILIATION_LOCK_TTL_MS,
  acquirePersistedLock,
  releasePersistedLock,
  type PersistedLockPrimitives,
} from "./automation-state";
import {
  classifyReconciliationRun,
  runDailyReconciliation,
  type OrganizationReconciliationOutcome,
} from "./daily-reconciliation";

const ORG = "atlanta-org";
const T0 = new Date("2026-09-06T03:00:00.000Z");

// --- classifyReconciliationRun (fail-closed status) ---------------------------

test("F. a run where every organization was verified is SUCCESS", () => {
  assert.deepEqual(
    classifyReconciliationRun([{ organizationId: ORG, outcome: "already_matched", mode: "No Limit" }]),
    { status: "SUCCESS", unverifiedOrganizationIds: [] },
  );
  assert.deepEqual(
    classifyReconciliationRun([
      { organizationId: ORG, outcome: "synchronized", previousMode: "Zero Export", newMode: "No Limit" },
    ]),
    { status: "SUCCESS", unverifiedOrganizationIds: [] },
  );
});

test("an empty run (no Atlanta organizations) is SUCCESS — nothing to verify is not a failure", () => {
  assert.deepEqual(classifyReconciliationRun([]), { status: "SUCCESS", unverifiedOrganizationIds: [] });
});

test("G. a run that could not retrieve actual FusionSolar state is NOT success", () => {
  assert.deepEqual(
    classifyReconciliationRun([
      { organizationId: ORG, outcome: "reconciliation_failed", error: "login timeout" },
    ]),
    { status: "FAILED", unverifiedOrganizationIds: [ORG] },
  );
  assert.equal(
    classifyReconciliationRun([{ organizationId: ORG, outcome: "unexpected_error", error: "boom" }]).status,
    "FAILED",
  );
  // Dongles disagree -> no single authoritative actual mode -> fail closed,
  // never fabricate one.
  assert.equal(
    classifyReconciliationRun([{ organizationId: ORG, outcome: "inconsistent_dongles" }]).status,
    "FAILED",
  );
});

test("fail-closed is per-run: one unverified organization fails the whole run", () => {
  const result = classifyReconciliationRun([
    { organizationId: "org-a", outcome: "already_matched", mode: "No Limit" },
    { organizationId: "org-b", outcome: "reconciliation_failed", error: "timeout" },
  ]);
  assert.equal(result.status, "FAILED");
  assert.deepEqual(result.unverifiedOrganizationIds, ["org-b"]);
});

test("a run held off ONLY by a concurrent reconciliation is SKIPPED, not FAILED", () => {
  assert.equal(
    classifyReconciliationRun([{ organizationId: ORG, outcome: "skipped_locked" }]).status,
    "SKIPPED",
  );
});

test("a stale_lock_reclaimed marker does not affect the status when the reconcile itself succeeded", () => {
  assert.equal(
    classifyReconciliationRun([
      { organizationId: ORG, outcome: "stale_lock_reclaimed", staleLockAgeMs: 999_999, heldSince: T0.toISOString() },
      { organizationId: ORG, outcome: "already_matched", mode: "No Limit" },
    ]).status,
    "SUCCESS",
  );
});

// --- runDailyReconciliation (independent lock) -------------------------------

/** Combined in-memory AutomationState row: an execution lock that is HELD,
 *  plus a free reconciliation lock, wired to the reconciliation columns
 *  only. */
function combinedRow() {
  const s = {
    execRunning: true,
    execLockedAt: new Date(T0),
    reconRunning: false,
    reconLockedAt: null as Date | null,
  };
  const reconPrimitives: PersistedLockPrimitives = {
    async ensureRow() {},
    async claimIfFree(_o, now) {
      if (s.reconRunning) return 0;
      s.reconRunning = true;
      s.reconLockedAt = now;
      return 1;
    },
    async reclaimIfStale(_o, now, before) {
      if (s.reconRunning && s.reconLockedAt && s.reconLockedAt.getTime() < before.getTime()) {
        s.reconLockedAt = now;
        return 1;
      }
      return 0;
    },
    async read() {
      return { running: s.reconRunning, lockedAt: s.reconLockedAt };
    },
    async release() {
      s.reconRunning = false;
    },
  };
  return { s, reconPrimitives };
}

test("D. runDailyReconciliation runs while the execution lock is held, and never touches it", async () => {
  const { s, reconPrimitives } = combinedRow();
  let reconciled = 0;

  const outcomes = await runDailyReconciliation({
    findOrganizations: async () => [ORG],
    acquireLock: (id) => acquirePersistedLock(reconPrimitives, id, RECONCILIATION_LOCK_TTL_MS),
    releaseLock: (id) => releasePersistedLock(reconPrimitives, id),
    reconcileOrganization: async (id) => {
      reconciled += 1;
      return { organizationId: id, outcome: "already_matched", mode: "No Limit" };
    },
  });

  assert.equal(reconciled, 1);
  assert.deepEqual(outcomes, [{ organizationId: ORG, outcome: "already_matched", mode: "No Limit" }]);
  // Execution lock untouched throughout.
  assert.equal(s.execRunning, true);
  assert.equal(s.execLockedAt.getTime(), T0.getTime());
  // Reconciliation lock released afterwards.
  assert.equal(s.reconRunning, false);
});

test("E. two concurrent reconciliations for the same plant cannot both run", async () => {
  const { reconPrimitives } = combinedRow();

  const reconcileOrganization = async (
    id: string,
  ): Promise<OrganizationReconciliationOutcome> => {
    // Yield so the two runs genuinely overlap while the lock is held.
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { organizationId: id, outcome: "already_matched", mode: "No Limit" };
  };

  const [runA, runB] = await Promise.all([
    runDailyReconciliation({
      findOrganizations: async () => [ORG],
      acquireLock: (id) => acquirePersistedLock(reconPrimitives, id, RECONCILIATION_LOCK_TTL_MS),
      releaseLock: (id) => releasePersistedLock(reconPrimitives, id),
      reconcileOrganization,
    }),
    runDailyReconciliation({
      findOrganizations: async () => [ORG],
      acquireLock: (id) => acquirePersistedLock(reconPrimitives, id, RECONCILIATION_LOCK_TTL_MS),
      releaseLock: (id) => releasePersistedLock(reconPrimitives, id),
      reconcileOrganization,
    }),
  ]);

  const all = [...runA, ...runB];
  assert.equal(all.filter((o) => o.outcome === "already_matched").length, 1);
  assert.equal(all.filter((o) => o.outcome === "skipped_locked").length, 1);
});

test("when the reconciliation lock is not acquired, the organization is skipped and reconcile is never called", async () => {
  let reconcileCalls = 0;

  const outcomes = await runDailyReconciliation({
    findOrganizations: async () => [ORG],
    acquireLock: async () => ({ acquired: false }),
    releaseLock: async () => {},
    reconcileOrganization: async (id) => {
      reconcileCalls += 1;
      return { organizationId: id, outcome: "already_matched", mode: null };
    },
  });

  assert.equal(reconcileCalls, 0);
  assert.deepEqual(outcomes, [{ organizationId: ORG, outcome: "skipped_locked" }]);
});

test("a stale reconciliation lock is reclaimed, surfaced as a marker outcome, and reconcile still runs", async () => {
  const outcomes = await runDailyReconciliation({
    findOrganizations: async () => [ORG],
    acquireLock: async () => ({
      acquired: true,
      reclaimedStaleLock: true,
      heldSince: T0,
      staleLockAgeMs: RECONCILIATION_LOCK_TTL_MS + 30_000,
    }),
    releaseLock: async () => {},
    reconcileOrganization: async (id) => ({ organizationId: id, outcome: "already_matched", mode: "No Limit" }),
  });

  assert.equal(outcomes.length, 2);
  const [marker, reconciled] = outcomes;
  assert.ok(marker && reconciled);
  assert.equal(marker.outcome, "stale_lock_reclaimed");
  assert.equal(reconciled.outcome, "already_matched");
  assert.equal(classifyReconciliationRun(outcomes).status, "SUCCESS");
});
