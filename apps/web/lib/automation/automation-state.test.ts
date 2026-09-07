import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EXECUTION_LOCK_TTL_MS,
  RECONCILIATION_LOCK_TTL_MS,
  acquirePersistedLock,
  releasePersistedLock,
  type PersistedLockPrimitives,
} from "./automation-state";

/**
 * In-memory binding of the persisted-lock primitives. Each primitive's
 * check-and-mutate runs with no `await` between the read and the write, so
 * it is atomic within one microtask — exactly the guarantee a single
 * Postgres `UPDATE ... WHERE` statement gives. Concurrent `acquirePersistedLock`
 * calls still interleave at the `await` points *between* primitives, which
 * is the real race these tests exercise.
 */
function inMemoryLock(
  initial: { running: boolean; lockedAt: Date | null } = { running: false, lockedAt: null },
) {
  const row = { ...initial };
  let ensureRowCalls = 0;

  const primitives: PersistedLockPrimitives = {
    async ensureRow() {
      ensureRowCalls += 1;
    },
    async claimIfFree(_organizationId, now) {
      if (row.running) return 0;
      row.running = true;
      row.lockedAt = now;
      return 1;
    },
    async reclaimIfStale(_organizationId, now, staleBefore) {
      if (row.running && row.lockedAt && row.lockedAt.getTime() < staleBefore.getTime()) {
        row.lockedAt = now;
        return 1;
      }
      return 0;
    },
    async read() {
      return { running: row.running, lockedAt: row.lockedAt };
    },
    async release() {
      row.running = false;
    },
  };

  return { row, primitives, ensureRowCalls: () => ensureRowCalls };
}

const TTL = EXECUTION_LOCK_TTL_MS;
const T0 = new Date("2026-09-05T09:15:18.407Z");

test("TTL constants are conservative and ordered (execution longer than reconciliation)", () => {
  assert.equal(EXECUTION_LOCK_TTL_MS, 15 * 60 * 1000);
  assert.equal(RECONCILIATION_LOCK_TTL_MS, 10 * 60 * 1000);
  assert.ok(EXECUTION_LOCK_TTL_MS > RECONCILIATION_LOCK_TTL_MS);
});

test("A. a fresh execution lock blocks another execution", async () => {
  const { primitives } = inMemoryLock();

  const first = await acquirePersistedLock(primitives, "org", TTL, T0);
  assert.deepEqual(first, { acquired: true, reclaimedStaleLock: false });

  const second = await acquirePersistedLock(primitives, "org", TTL, T0);
  assert.deepEqual(second, { acquired: false });
});

test("a valid (recently-held) lock cannot be reclaimed before the TTL elapses", async () => {
  const { primitives } = inMemoryLock({ running: true, lockedAt: T0 });

  const result = await acquirePersistedLock(
    primitives,
    "org",
    TTL,
    new Date(T0.getTime() + TTL - 1000),
  );

  assert.deepEqual(result, { acquired: false });
});

test("B. a stale execution lock can be reclaimed after the TTL", async () => {
  const { primitives, row } = inMemoryLock({ running: true, lockedAt: T0 });
  const now = new Date(T0.getTime() + TTL + 1000);

  const result = await acquirePersistedLock(primitives, "org", TTL, now);

  assert.equal(result.acquired, true);
  assert.equal(result.acquired && result.reclaimedStaleLock, true);
  if (result.acquired && result.reclaimedStaleLock) {
    assert.equal(result.heldSince.getTime(), T0.getTime());
    assert.equal(result.staleLockAgeMs, TTL + 1000);
  }
  // The lock stays held (running: true) — it was taken over, not released —
  // with a refreshed timestamp so the NEXT caller can't also reclaim it.
  assert.equal(row.running, true);
  assert.equal(row.lockedAt?.getTime(), now.getTime());
});

test("C. two concurrent stale-lock reclaim attempts produce exactly ONE winner", async () => {
  const { primitives } = inMemoryLock({ running: true, lockedAt: T0 });
  const now = new Date(T0.getTime() + TTL + 5000);

  const results = await Promise.all(
    Array.from({ length: 12 }, () => acquirePersistedLock(primitives, "org", TTL, now)),
  );

  const reclaimers = results.filter((r) => r.acquired && r.reclaimedStaleLock);
  const losers = results.filter((r) => !r.acquired);

  assert.equal(reclaimers.length, 1);
  assert.equal(losers.length, 11);
});

test("E. two concurrent fresh-lock acquisitions produce exactly ONE winner (also: no two reconciliations for one plant)", async () => {
  const { primitives } = inMemoryLock();

  const results = await Promise.all(
    Array.from({ length: 12 }, () => acquirePersistedLock(primitives, "org", TTL, T0)),
  );

  const winners = results.filter((r) => r.acquired && !r.reclaimedStaleLock);
  const losers = results.filter((r) => !r.acquired);

  assert.equal(winners.length, 1);
  assert.equal(losers.length, 11);
});

test("D. a lock bound to reconciliation columns is acquired even while the execution lock is held, and never touches it", async () => {
  // One combined row: execution lock held, reconciliation lock free.
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

  const result = await acquirePersistedLock(reconPrimitives, "org", RECONCILIATION_LOCK_TTL_MS, T0);

  assert.deepEqual(result, { acquired: true, reclaimedStaleLock: false });
  assert.equal(s.reconRunning, true);
  // The execution lock is completely untouched.
  assert.equal(s.execRunning, true);
  assert.equal(s.execLockedAt.getTime(), T0.getTime());
});

test("H. a normal release clears the lock so the next cycle acquires it fresh", async () => {
  const { primitives, row } = inMemoryLock();

  await acquirePersistedLock(primitives, "org", TTL, T0);
  await releasePersistedLock(primitives, "org");
  assert.equal(row.running, false);

  const next = await acquirePersistedLock(primitives, "org", TTL, new Date(T0.getTime() + 60_000));
  assert.deepEqual(next, { acquired: true, reclaimedStaleLock: false });
});

test("I. the lock is released even when the guarded work throws (finally-style release)", async () => {
  const { primitives, row } = inMemoryLock();

  await acquirePersistedLock(primitives, "org", TTL, T0);
  try {
    throw new Error("guarded work failed");
  } catch {
    await releasePersistedLock(primitives, "org");
  }

  assert.equal(row.running, false);
  const next = await acquirePersistedLock(primitives, "org", TTL, new Date(T0.getTime() + 1000));
  assert.equal(next.acquired, true);
});

test("J. a killed process leaves the lock persisted; a later cycle reclaims it only after the TTL", async () => {
  const { primitives, row } = inMemoryLock();

  // Cycle 1 acquires the lock, then its process is killed — release never runs.
  const acquired = await acquirePersistedLock(primitives, "org", TTL, T0);
  assert.equal(acquired.acquired, true);
  assert.equal(row.running, true); // still persisted, no release

  // A cycle 13 minutes later (inside the TTL) still cannot take it.
  const tooSoon = await acquirePersistedLock(
    primitives,
    "org",
    TTL,
    new Date(T0.getTime() + 13 * 60 * 1000),
  );
  assert.deepEqual(tooSoon, { acquired: false });

  // A cycle past the TTL reclaims it.
  const reclaimed = await acquirePersistedLock(
    primitives,
    "org",
    TTL,
    new Date(T0.getTime() + TTL + 1000),
  );
  assert.equal(reclaimed.acquired, true);
  assert.equal(reclaimed.acquired && reclaimed.reclaimedStaleLock, true);
});

test("ensureRow runs on every acquire (first-run safety)", async () => {
  const lock = inMemoryLock();
  await acquirePersistedLock(lock.primitives, "org", TTL, T0);
  await acquirePersistedLock(lock.primitives, "org", TTL, T0);
  assert.equal(lock.ensureRowCalls(), 2);
});
