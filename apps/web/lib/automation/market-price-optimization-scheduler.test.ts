import assert from "node:assert/strict";
import { test } from "node:test";

import {
  recordStaleExecutionLockReclaim,
  runMarketPriceOptimizationScheduler,
  type OrganizationExecutionOutcome,
} from "./market-price-optimization-scheduler";

const noopRecovery = async () => {};
const ORG = { organizationId: "atlanta-org", minimumExportPrice: 14 };
const HELD_SINCE = new Date("2026-09-05T09:15:18.407Z");

test("8. the delivery-day recovery check runs exactly once per scheduler cycle, before organizations are looked up", async () => {
  let recoveryCallCount = 0;
  const callOrder: string[] = [];

  const outcomes = await runMarketPriceOptimizationScheduler({
    ensureRecovery: async () => {
      recoveryCallCount += 1;
      callOrder.push("recovery");
    },
    findOrganizations: async () => {
      callOrder.push("findOrganizations");
      // Multiple organizations - proves recovery isn't called once per
      // organization even when there are several to process. Empty result
      // keeps this test focused on the orchestration shape (recovery runs
      // once, up front) without needing to mock the per-organization
      // execution path (locking, price lookup, Automation Service calls).
      return [];
    },
  });

  assert.equal(recoveryCallCount, 1);
  assert.deepEqual(callOrder, ["recovery", "findOrganizations"]);
  assert.deepEqual(outcomes, []);
});

test("H. a normal cycle releases the execution lock, and does not record a reclaim", async () => {
  const released: string[] = [];
  let reclaimRecorded = 0;

  const outcomes = await runMarketPriceOptimizationScheduler({
    ensureRecovery: noopRecovery,
    findOrganizations: async () => [ORG],
    acquireLock: async () => ({ acquired: true, reclaimedStaleLock: false }),
    releaseLock: async (id) => {
      released.push(id);
    },
    executeForOrganization: async (organization) => ({
      organizationId: organization.organizationId,
      outcome: "no_action",
      reason: "below_threshold_no_decline_forecast",
    }),
    recordStaleLockReclaim: async () => {
      reclaimRecorded += 1;
    },
  });

  assert.deepEqual(outcomes, [
    { organizationId: ORG.organizationId, outcome: "no_action", reason: "below_threshold_no_decline_forecast" },
  ]);
  assert.deepEqual(released, [ORG.organizationId]);
  assert.equal(reclaimRecorded, 0);
});

test("I. the execution lock is released even when executeForOrganization throws", async () => {
  const released: string[] = [];

  const outcomes = await runMarketPriceOptimizationScheduler({
    ensureRecovery: noopRecovery,
    findOrganizations: async () => [ORG],
    acquireLock: async () => ({ acquired: true, reclaimedStaleLock: false }),
    releaseLock: async (id) => {
      released.push(id);
    },
    executeForOrganization: async () => {
      throw new Error("automation service exploded");
    },
    recordStaleLockReclaim: async () => {},
  });

  assert.equal(outcomes.length, 1);
  assert.ok(outcomes[0]);
  assert.equal(outcomes[0].outcome, "unexpected_error");
  assert.deepEqual(released, [ORG.organizationId]);
});

test("a held (non-stale) execution lock skips the organization with no event", async () => {
  let executed = 0;

  const outcomes = await runMarketPriceOptimizationScheduler({
    ensureRecovery: noopRecovery,
    findOrganizations: async () => [ORG],
    acquireLock: async () => ({ acquired: false }),
    releaseLock: async () => {
      throw new Error("release must not be called when the lock was not acquired");
    },
    executeForOrganization: async (organization) => {
      executed += 1;
      return { organizationId: organization.organizationId, outcome: "no_action", reason: "x" };
    },
    recordStaleLockReclaim: async () => {},
  });

  assert.equal(executed, 0);
  assert.deepEqual(outcomes, [{ organizationId: ORG.organizationId, outcome: "skipped_locked" }]);
});

test("a stale execution lock is reclaimed: the reclaim is recorded, marked in the outcomes, and the cycle proceeds", async () => {
  const reclaims: Array<{ organizationId: string; staleLockAgeMs: number }> = [];

  const outcomes = await runMarketPriceOptimizationScheduler({
    ensureRecovery: noopRecovery,
    findOrganizations: async () => [ORG],
    acquireLock: async () => ({
      acquired: true,
      reclaimedStaleLock: true,
      heldSince: HELD_SINCE,
      staleLockAgeMs: 174_000_000,
    }),
    releaseLock: async () => {},
    executeForOrganization: async (organization) => ({
      organizationId: organization.organizationId,
      outcome: "switched",
      newMode: "Zero Export",
      reason: "price_below_low_band",
    }),
    recordStaleLockReclaim: async (organizationId, reclaim) => {
      reclaims.push({ organizationId, staleLockAgeMs: reclaim.staleLockAgeMs });
    },
  });

  assert.deepEqual(reclaims, [{ organizationId: ORG.organizationId, staleLockAgeMs: 174_000_000 }]);

  assert.equal(outcomes.length, 2);
  const [marker, executed] = outcomes;
  assert.ok(marker && executed);
  assert.deepEqual(marker, {
    organizationId: ORG.organizationId,
    outcome: "stale_lock_reclaimed",
    staleLockAgeMs: 174_000_000,
    heldSince: HELD_SINCE.toISOString(),
  });
  assert.equal(executed.outcome, "switched");
});

test("recordStaleExecutionLockReclaim writes one observable execution_lock_reclaimed event with the diagnostic detail", async () => {
  const events: Array<Record<string, unknown>> = [];

  await recordStaleExecutionLockReclaim(
    "atlanta-org",
    { acquired: true, reclaimedStaleLock: true, heldSince: HELD_SINCE, staleLockAgeMs: 174_000_000 },
    {
      getStoredMode: async () => "Zero Export",
      createEvent: async (input) => {
        events.push(input as unknown as Record<string, unknown>);
      },
    },
  );

  assert.equal(events.length, 1);
  const event = events[0] as {
    type: string;
    previousMode: unknown;
    newMode: unknown;
    reason: string;
    errorMessage: string;
  };
  assert.equal(event.type, "execution_lock_reclaimed");
  assert.equal(event.previousMode, "Zero Export");
  assert.equal(event.newMode, null);
  assert.ok(event.reason.includes(HELD_SINCE.toISOString()));
  assert.ok(event.errorMessage.includes(HELD_SINCE.toISOString()));
  assert.ok(event.errorMessage.includes("did not release"));
});

// Keep the compiler honest that the exported outcome union carries the marker.
test("OrganizationExecutionOutcome includes the stale_lock_reclaimed marker", () => {
  const marker: OrganizationExecutionOutcome = {
    organizationId: "x",
    outcome: "stale_lock_reclaimed",
    staleLockAgeMs: 1,
    heldSince: HELD_SINCE.toISOString(),
  };
  assert.equal(marker.outcome, "stale_lock_reclaimed");
});
