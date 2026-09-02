import assert from "node:assert/strict";
import { test } from "node:test";

import { ensureBulgariaDeliveryDayAvailable } from "./ensure-delivery-day-available";

const FIXED_NOW = new Date("2026-09-02T09:00:00Z"); // 2026-09-02 in Europe/Sofia
const passthroughLock = async (_day: Date, fn: () => Promise<void>) => fn();

test("1. a delivery day before 2026-07-01 never triggers recovery", async () => {
  let isCompleteCalled = false;
  let recoverCalled = false;

  await ensureBulgariaDeliveryDayAvailable(new Date("2026-06-30T00:00:00Z"), 1000, {
    now: () => FIXED_NOW,
    isComplete: async () => {
      isCompleteCalled = true;
      return false;
    },
    recover: async () => {
      recoverCalled = true;
      return { imported: true, errors: [] };
    },
    withLock: passthroughLock,
  });

  assert.equal(isCompleteCalled, false);
  assert.equal(recoverCalled, false);
});

test("2. a future delivery day (after today's Bulgaria date) never triggers recovery", async () => {
  let isCompleteCalled = false;
  let recoverCalled = false;

  await ensureBulgariaDeliveryDayAvailable(new Date("2026-09-03T00:00:00Z"), 1000, {
    now: () => FIXED_NOW,
    isComplete: async () => {
      isCompleteCalled = true;
      return false;
    },
    recover: async () => {
      recoverCalled = true;
      return { imported: true, errors: [] };
    },
    withLock: passthroughLock,
  });

  assert.equal(isCompleteCalled, false);
  assert.equal(recoverCalled, false);
});

test("3. a missing (never-imported) day within range triggers full-day recovery", async () => {
  let recoveredDay: Date | null = null;

  await ensureBulgariaDeliveryDayAvailable(new Date("2026-09-01T00:00:00Z"), 1000, {
    now: () => FIXED_NOW,
    isComplete: async () => false,
    recover: async (day) => {
      recoveredDay = day;
      return { imported: true, errors: [] };
    },
    withLock: passthroughLock,
  });

  assert.ok(recoveredDay);
  assert.equal((recoveredDay as Date).toISOString(), "2026-09-01T00:00:00.000Z");
});

test("4. an already-complete day never triggers a fetch", async () => {
  let recoverCalled = false;
  let lockCalled = false;

  await ensureBulgariaDeliveryDayAvailable(new Date("2026-09-01T00:00:00Z"), 1000, {
    now: () => FIXED_NOW,
    isComplete: async () => true,
    recover: async () => {
      recoverCalled = true;
      return { imported: true, errors: [] };
    },
    withLock: async (day, fn) => {
      lockCalled = true;
      await fn();
    },
  });

  assert.equal(lockCalled, false);
  assert.equal(recoverCalled, false);
});

test("5. a partially-imported (incomplete) day triggers full-day recovery", async () => {
  let recoverCallCount = 0;

  await ensureBulgariaDeliveryDayAvailable(new Date("2026-09-01T00:00:00Z"), 1000, {
    now: () => FIXED_NOW,
    isComplete: async () => false, // e.g. isPartial:true today
    recover: async () => {
      recoverCallCount += 1;
      return { imported: true, errors: [] };
    },
    withLock: passthroughLock,
  });

  assert.equal(recoverCallCount, 1);
});

test("6. concurrent recovery for the same day performs only one ENTSO-E import", async () => {
  let recoverCallCount = 0;
  let dayIsComplete = false;

  // Models a genuine mutual-exclusion lock (like the real
  // pg_advisory_xact_lock) purely in-process: the second caller's callback
  // cannot start until the first caller's callback has fully settled.
  let queue: Promise<unknown> = Promise.resolve();
  const serializingLock = (_day: Date, fn: () => Promise<void>) => {
    const run = queue.then(fn);
    queue = run.catch(() => undefined);
    return run;
  };

  const isComplete = async () => dayIsComplete;
  const recover = async () => {
    recoverCallCount += 1;
    dayIsComplete = true;
    return { imported: true, errors: [] };
  };

  await Promise.all([
    ensureBulgariaDeliveryDayAvailable(new Date("2026-09-01T00:00:00Z"), 1000, {
      now: () => FIXED_NOW,
      isComplete,
      recover,
      withLock: serializingLock,
    }),
    ensureBulgariaDeliveryDayAvailable(new Date("2026-09-01T00:00:00Z"), 1000, {
      now: () => FIXED_NOW,
      isComplete,
      recover,
      withLock: serializingLock,
    }),
  ]);

  assert.equal(recoverCallCount, 1);
});

test("7. a recovery failure is swallowed - never throws, existing fail-closed handling is left to the caller", async () => {
  await assert.doesNotReject(() =>
    ensureBulgariaDeliveryDayAvailable(new Date("2026-09-01T00:00:00Z"), 1000, {
      now: () => FIXED_NOW,
      isComplete: async () => false,
      recover: async () => {
        throw new Error("ENTSO-E API request failed with status 503");
      },
      withLock: passthroughLock,
    }),
  );
});

test("7b. a recovery that reports failure without throwing also never fabricates completeness", async () => {
  let secondCompleteCheck: boolean | undefined;
  let completeCallCount = 0;

  await ensureBulgariaDeliveryDayAvailable(new Date("2026-09-01T00:00:00Z"), 1000, {
    now: () => FIXED_NOW,
    isComplete: async () => {
      completeCallCount += 1;
      const result = false; // stays incomplete even after a failed recovery attempt
      if (completeCallCount === 2) secondCompleteCheck = result;
      return result;
    },
    recover: async () => ({ imported: false, errors: ["ENTSO-E has no data available for the requested period"] }),
    withLock: passthroughLock,
  });

  assert.equal(secondCompleteCheck, false);
});
