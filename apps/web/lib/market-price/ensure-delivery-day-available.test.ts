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

// --- Production Latency Architecture: mode: "background" ---
// Every real production caller (Market/Dashboard via market-data.ts, the
// Market Price Optimization scheduler) uses this mode. `mode: "blocking"`
// (tests 1-7b above, the default when `mode` is omitted) is preserved
// unchanged for backward compatibility.

test("8. background mode returns before the deferred recovery runs at all - the caller never waits on ENTSO-E/IBEX", async () => {
  let scheduledTask: (() => Promise<void>) | undefined;
  let recoverCalled = false;

  await ensureBulgariaDeliveryDayAvailable(new Date("2026-09-01T00:00:00Z"), 1000, {
    now: () => FIXED_NOW,
    isComplete: async () => false,
    recover: async () => {
      recoverCalled = true;
      return { imported: true, errors: [] };
    },
    withLock: passthroughLock,
    mode: "background",
    // Mirrors Next.js `after()`'s fire-and-forget contract without needing
    // a real request scope: capture the deferred work instead of running
    // it inline.
    schedule: (fn) => {
      scheduledTask = fn;
    },
  });

  // The outer call already resolved without the scheduled recovery having
  // run at all - proof the caller did not wait for ENTSO-E/IBEX.
  assert.equal(recoverCalled, false);
  assert.ok(scheduledTask);

  await scheduledTask?.();

  assert.equal(recoverCalled, true);
});

test("9. background mode still performs full-day recovery once the deferred task runs", async () => {
  let scheduledTask: (() => Promise<void>) | undefined;
  let recoveredDay: Date | null = null;

  await ensureBulgariaDeliveryDayAvailable(new Date("2026-09-01T00:00:00Z"), 1000, {
    now: () => FIXED_NOW,
    isComplete: async () => false,
    recover: async (day) => {
      recoveredDay = day;
      return { imported: true, errors: [] };
    },
    withLock: passthroughLock,
    mode: "background",
    schedule: (fn) => {
      scheduledTask = fn;
    },
  });

  assert.ok(scheduledTask);
  await scheduledTask?.();

  assert.ok(recoveredDay);
  assert.equal((recoveredDay as Date).toISOString(), "2026-09-01T00:00:00.000Z");
});

test("10. background mode: an already-complete day never schedules anything", async () => {
  let scheduleCalled = false;

  await ensureBulgariaDeliveryDayAvailable(new Date("2026-09-01T00:00:00Z"), 1000, {
    now: () => FIXED_NOW,
    isComplete: async () => true,
    recover: async () => ({ imported: true, errors: [] }),
    withLock: passthroughLock,
    mode: "background",
    schedule: () => {
      scheduleCalled = true;
    },
  });

  assert.equal(scheduleCalled, false);
});

test("11. background mode: concurrent callers for the same day still perform only one provider fetch (real lock semantics preserved)", async () => {
  let recoverCallCount = 0;
  let dayIsComplete = false;

  // Models the real pg_advisory_xact_lock's mutual exclusion purely
  // in-process, same technique as test 6.
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

  const scheduledTasks: Array<() => Promise<void>> = [];
  const schedule = (fn: () => Promise<void>) => {
    scheduledTasks.push(fn);
  };

  await Promise.all([
    ensureBulgariaDeliveryDayAvailable(new Date("2026-09-01T00:00:00Z"), 1000, {
      now: () => FIXED_NOW,
      isComplete,
      recover,
      withLock: serializingLock,
      mode: "background",
      schedule,
    }),
    ensureBulgariaDeliveryDayAvailable(new Date("2026-09-01T00:00:00Z"), 1000, {
      now: () => FIXED_NOW,
      isComplete,
      recover,
      withLock: serializingLock,
      mode: "background",
      schedule,
    }),
  ]);

  // Both callers observed the day as incomplete before either's deferred
  // task ran, so both scheduled recovery - exactly what the advisory lock
  // (and the re-check-after-lock inside it) exists to make safe.
  assert.equal(scheduledTasks.length, 2);

  await Promise.all(scheduledTasks.map((task) => task()));

  assert.equal(recoverCallCount, 1);
});

test("12. background mode: a deferred recovery failure is caught, never an unhandled rejection", async () => {
  let scheduledTask: (() => Promise<void>) | undefined;

  await ensureBulgariaDeliveryDayAvailable(new Date("2026-09-01T00:00:00Z"), 1000, {
    now: () => FIXED_NOW,
    isComplete: async () => false,
    recover: async () => {
      throw new Error("ENTSO-E: down; IBEX: down");
    },
    withLock: passthroughLock,
    mode: "background",
    schedule: (fn) => {
      scheduledTask = fn;
    },
  });

  assert.ok(scheduledTask);
  await assert.doesNotReject(() => scheduledTask!());
});
