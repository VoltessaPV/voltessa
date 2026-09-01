import assert from "node:assert/strict";
import { test } from "node:test";

import { refreshTomorrowWithTrailingRecovery } from "./refresh-market-prices";

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
