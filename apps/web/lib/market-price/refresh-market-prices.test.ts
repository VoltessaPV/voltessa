import assert from "node:assert/strict";
import { test } from "node:test";

import {
  computeRecoveryDeadline,
  ensureMarketPricesForBulgariaDays,
  refreshTomorrowWithTrailingRecovery,
  type MarketPriceRefreshResult,
} from "./refresh-market-prices";

const PERIOD_START = new Date("2026-08-30T22:00:00Z");
const PERIOD_END = new Date("2026-08-31T22:00:00Z");

function fakeResult(overrides: Partial<MarketPriceRefreshResult> = {}): MarketPriceRefreshResult {
  return {
    biddingZone: "10YCA-BULGARIA-R",
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    expectedIntervals: 96,
    importedIntervals: 96,
    missingIntervals: 0,
    isPartial: false,
    recordsInserted: 96,
    duplicatesSkipped: 0,
    unavailable: false,
    ...overrides,
  };
}

test("refreshTomorrowWithTrailingRecovery still attempts trailing recovery when the primary import fails, and rethrows the primary error", async () => {
  let recoverCalled = false;
  const primaryError = new Error("ENTSO-E API request failed with status 503");

  await assert.rejects(
    () =>
      refreshTomorrowWithTrailingRecovery(new Date(), {
        refresh: async () => {
          throw primaryError;
        },
        recover: async () => {
          recoverCalled = true;
          return { imported: true, errors: [], fallbackUsed: false };
        },
      }),
    primaryError,
  );

  assert.equal(recoverCalled, true);
});

test("refreshTomorrowWithTrailingRecovery rethrows the primary error even when recovery itself also fails", async () => {
  const primaryError = new Error("primary import failed");

  await assert.rejects(
    () =>
      refreshTomorrowWithTrailingRecovery(new Date(), {
        refresh: async () => {
          throw primaryError;
        },
        recover: async () => {
          throw new Error("recovery also failed");
        },
      }),
    primaryError,
  );
});

test("computeRecoveryDeadline is 05:00 Europe/Sofia on the delivery day's own calendar date", () => {
  // 2026-09-03 is a CEST (UTC+2) day for the CET reference zone and an
  // EEST (UTC+3) day for Sofia - 05:00 Sofia local is 02:00 UTC.
  const tomorrow = new Date("2026-09-03T10:00:00Z"); // midday UTC, unambiguously CET calendar day 2026-09-03
  const deadline = computeRecoveryDeadline(tomorrow);

  assert.equal(deadline.toISOString(), "2026-09-03T02:00:00.000Z");
});

test("computeRecoveryDeadline is DST-safe for the winter (CET/EET) offset", () => {
  // 2026-01-15 is CET (UTC+1) for Brussels and EET (UTC+2) for Sofia -
  // 05:00 Sofia local is 03:00 UTC.
  const tomorrow = new Date("2026-01-15T10:00:00Z");
  const deadline = computeRecoveryDeadline(tomorrow);

  assert.equal(deadline.toISOString(), "2026-01-15T03:00:00.000Z");
});

// --- IBEX Fallback: ensureMarketPricesForBulgariaDays orchestration ---

const BULGARIA_DAY_START = new Date("2026-08-30T21:00:00Z"); // 2026-08-31 00:00 Europe/Sofia

test("1. ENTSO-E complete -> IBEX not called", async () => {
  let ibexCalled = false;

  const outcome = await ensureMarketPricesForBulgariaDays([BULGARIA_DAY_START], undefined, {
    isComplete: async () => false,
    refreshEntsoe: async () => fakeResult(),
    refreshIbex: async () => {
      ibexCalled = true;
      return fakeResult();
    },
  });

  assert.equal(ibexCalled, false);
  assert.equal(outcome.imported, true);
  assert.equal(outcome.fallbackUsed, false);
});

test("2. ENTSO-E unavailable -> IBEX called", async () => {
  let ibexCalled = false;

  await ensureMarketPricesForBulgariaDays([BULGARIA_DAY_START], undefined, {
    isComplete: async () => false,
    refreshEntsoe: async () => fakeResult({ unavailable: true, isPartial: true }),
    refreshIbex: async () => {
      ibexCalled = true;
      return fakeResult();
    },
  });

  assert.equal(ibexCalled, true);
});

test("3. ENTSO-E incomplete (partial) -> IBEX called", async () => {
  let ibexCalled = false;

  await ensureMarketPricesForBulgariaDays([BULGARIA_DAY_START], undefined, {
    isComplete: async () => false,
    refreshEntsoe: async () => fakeResult({ isPartial: true, importedIntervals: 90, missingIntervals: 6 }),
    refreshIbex: async () => {
      ibexCalled = true;
      return fakeResult();
    },
  });

  assert.equal(ibexCalled, true);
});

test("4. IBEX complete -> full day persisted, reported as fallback", async () => {
  const outcome = await ensureMarketPricesForBulgariaDays([BULGARIA_DAY_START], undefined, {
    isComplete: async () => false,
    refreshEntsoe: async () => {
      throw new Error("ENTSO-E API request failed with status 503");
    },
    refreshIbex: async () => fakeResult(),
  });

  assert.equal(outcome.imported, true);
  assert.equal(outcome.fallbackUsed, true);
});

test("5. both providers fail -> day remains incomplete", async () => {
  const outcome = await ensureMarketPricesForBulgariaDays([BULGARIA_DAY_START], undefined, {
    isComplete: async () => false,
    refreshEntsoe: async () => {
      throw new Error("ENTSO-E down");
    },
    refreshIbex: async () => {
      throw new Error("IBEX down");
    },
  });

  assert.equal(outcome.imported, false);
  assert.ok(outcome.errors.some((e) => e.includes("ENTSO-E")));
  assert.ok(outcome.errors.some((e) => e.includes("IBEX")));
});

test("6. already complete -> no external requests to either provider", async () => {
  let entsoeCalled = false;
  let ibexCalled = false;

  const outcome = await ensureMarketPricesForBulgariaDays([BULGARIA_DAY_START], undefined, {
    isComplete: async () => true,
    refreshEntsoe: async () => {
      entsoeCalled = true;
      return fakeResult();
    },
    refreshIbex: async () => {
      ibexCalled = true;
      return fakeResult();
    },
  });

  assert.equal(entsoeCalled, false);
  assert.equal(ibexCalled, false);
  assert.equal(outcome.imported, true);
  assert.equal(outcome.fallbackUsed, false);
});

test("12. a provider that only returns a partial result never counts as recovered (no stale/partial substitution)", async () => {
  const outcome = await ensureMarketPricesForBulgariaDays([BULGARIA_DAY_START], undefined, {
    isComplete: async () => false,
    refreshEntsoe: async () => fakeResult({ isPartial: true, importedIntervals: 80, missingIntervals: 16 }),
    refreshIbex: async () => fakeResult({ isPartial: true, importedIntervals: 80, missingIntervals: 16 }),
  });

  assert.equal(outcome.imported, false);
});
