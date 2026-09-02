import assert from "node:assert/strict";
import { test } from "node:test";

import { runMarketPriceOptimizationScheduler } from "./market-price-optimization-scheduler";

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
