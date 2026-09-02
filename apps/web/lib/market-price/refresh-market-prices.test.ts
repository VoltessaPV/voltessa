import assert from "node:assert/strict";
import { test } from "node:test";

import { computeRecoveryDeadline, refreshTomorrowWithTrailingRecovery } from "./refresh-market-prices";

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
          return { imported: true, errors: [] };
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
