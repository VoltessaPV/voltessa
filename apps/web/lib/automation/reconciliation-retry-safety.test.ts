import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { RunStatus } from "@prisma/client";

import type { ExportMode } from "./export-decision";
import {
  runAtlantaMorningReconciliation,
  type ReconciliationAttemptStore,
} from "./reconciliation-retry";
import { reconciliationSlotsForDate } from "./reconciliation-retry-schedule";

const ORG = "atlanta-org";
const SLOTS = reconciliationSlotsForDate(new Date("2026-08-15T12:00:00Z")); // Sofia summer

/**
 * Date-keyed in-memory `ReconciliationAttemptStore` — models the real
 * `@@unique([organizationId, reconciliationDate])`: a different Europe/Sofia
 * date is a different row, so a previous day's retry state cannot leak.
 * Mutating ops are check-and-set with no `await` in the critical section
 * (== one atomic SQL statement).
 */
function dateKeyedStore() {
  type R = {
    lastDispatchedSlot: number;
    completedAttempts: number;
    succeeded: boolean;
    finalFailureNotifiedAt: Date | null;
    lastFailureReason: string | null;
  };
  const rows = new Map<string, R>();
  const key = (o: string, d: Date) => `${o}::${d.toISOString()}`;
  const get = (o: string, d: Date) => {
    const k = key(o, d);
    if (!rows.has(k)) {
      rows.set(k, {
        lastDispatchedSlot: -1,
        completedAttempts: 0,
        succeeded: false,
        finalFailureNotifiedAt: null,
        lastFailureReason: null,
      });
    }
    return rows.get(k)!;
  };

  const store: ReconciliationAttemptStore = {
    async loadOrCreate(o, d) {
      return { ...get(o, d) };
    },
    async claimSlot(o, d, slotIndex) {
      const r = get(o, d);
      if (r.succeeded || r.lastDispatchedSlot >= slotIndex) return false;
      r.lastDispatchedSlot = slotIndex;
      return true;
    },
    async markSucceeded(o, d) {
      const r = get(o, d);
      r.succeeded = true;
      r.completedAttempts += 1;
      r.lastFailureReason = null;
    },
    async recordCompletedFailure(o, d, reason) {
      const r = get(o, d);
      if (r.succeeded) return;
      r.completedAttempts += 1;
      r.lastFailureReason = reason;
    },
    async recordLockSkipped(o, d, reason) {
      const r = get(o, d);
      if (!r.succeeded) r.lastFailureReason = reason;
    },
    async claimFinalFailureNotification(o, d, now) {
      const r = get(o, d);
      if (r.succeeded || r.finalFailureNotifiedAt) return false;
      r.finalFailureNotifiedAt = now;
      return true;
    },
  };
  return { rows, store };
}

function baseOverrides(store: ReconciliationAttemptStore, notifications: unknown[]) {
  return {
    findOrganizations: async () => [ORG],
    store,
    getStoredMode: async (): Promise<ExportMode | null> => "Zero Export",
    sendFinalFailureNotification: async () => {
      notifications.push(1);
    },
  };
}

test("failure at 06:00 then success at 06:15 -> retry chain stops, no failure notification", async () => {
  const { store, rows } = dateKeyedStore();
  const notifications: unknown[] = [];
  const seq: RunStatus[] = ["FAILED", "SUCCESS"];
  let i = 0;
  const ov = { ...baseOverrides(store, notifications), runOneReconciliation: async () => seq[i++]! };

  await runAtlantaMorningReconciliation({ ...ov, now: new Date(SLOTS[0]!.getTime()) }); // 06:00 FAILED
  await runAtlantaMorningReconciliation({ ...ov, now: new Date(SLOTS[1]!.getTime()) }); // 06:15 SUCCESS
  const r3 = await runAtlantaMorningReconciliation({ ...ov, now: new Date(SLOTS[2]!.getTime()) }); // 06:30

  assert.equal(i, 2, "only the 06:00 and 06:15 attempts ran");
  assert.equal(notifications.length, 0);
  assert.deepEqual(r3, [{ organizationId: ORG, action: "skip", reason: "already_succeeded" }]);
  assert.equal([...rows.values()][0]!.succeeded, true);
  assert.equal([...rows.values()][0]!.finalFailureNotifiedAt, null);
});

test("7. previous-day retry state cannot affect the next day", async () => {
  const { store, rows } = dateKeyedStore();
  const notifications: unknown[] = [];
  const ov = baseOverrides(store, notifications);

  // Day 1 (2026-08-15): all five fail -> exactly one notification.
  const day1 = reconciliationSlotsForDate(new Date("2026-08-15T12:00:00Z"));
  for (let s = 0; s < 5; s += 1) {
    await runAtlantaMorningReconciliation({
      ...ov,
      now: new Date(day1[s]!.getTime()),
      runOneReconciliation: async () => "FAILED" as RunStatus,
    });
  }
  assert.equal(notifications.length, 1);
  assert.equal(rows.size, 1);

  // Day 2 (2026-08-16): 06:00 succeeds -> its own fresh row, unaffected by day 1.
  const day2 = reconciliationSlotsForDate(new Date("2026-08-16T12:00:00Z"));
  const r = await runAtlantaMorningReconciliation({
    ...ov,
    now: new Date(day2[0]!.getTime()),
    runOneReconciliation: async () => "SUCCESS" as RunStatus,
  });

  assert.deepEqual(r, [
    { organizationId: ORG, action: "attempted", slotIndex: 0, isFinalSlot: false, status: "SUCCESS" },
  ]);
  assert.equal(rows.size, 2, "day 2 got its own row");
  assert.equal(notifications.length, 1, "no new notification on day 2");
});

test("3. no retry after 07:00: an invocation at 07:20 (past the window) does nothing new", async () => {
  const { store } = dateKeyedStore();
  const notifications: unknown[] = [];
  const ov = { ...baseOverrides(store, notifications), runOneReconciliation: async () => "FAILED" as RunStatus };

  for (let s = 0; s < 5; s += 1) {
    await runAtlantaMorningReconciliation({ ...ov, now: new Date(SLOTS[s]!.getTime()) });
  }
  assert.equal(notifications.length, 1);

  const past = new Date(SLOTS[4]!.getTime() + 20 * 60_000); // 07:20 Sofia
  const r = await runAtlantaMorningReconciliation({ ...ov, now: past });

  assert.deepEqual(r, [{ organizationId: ORG, action: "skip", reason: "after_window" }]);
  assert.equal(notifications.length, 1);
});

test("6. a slow earlier attempt that verifies just before the 07:00 tick suppresses the final-failure notification", async () => {
  const { store, rows } = dateKeyedStore();
  const notifications: unknown[] = [];
  const ov = baseOverrides(store, notifications);
  const d = reconciliationSlotsForDate(new Date("2026-08-15T12:00:00Z"));

  // The slow slot-3 attempt returns SUCCESS.
  await runAtlantaMorningReconciliation({
    ...ov,
    now: new Date(d[3]!.getTime()),
    runOneReconciliation: async () => "SUCCESS" as RunStatus,
  });

  // The 07:00 tick fires while the row is already succeeded -> no attempt, no alert.
  const r = await runAtlantaMorningReconciliation({
    ...ov,
    now: new Date(d[4]!.getTime()),
    runOneReconciliation: async () => "FAILED" as RunStatus,
  });

  assert.deepEqual(r, [{ organizationId: ORG, action: "skip", reason: "already_succeeded" }]);
  assert.equal(notifications.length, 0);
  assert.equal([...rows.values()][0]!.succeeded, true);
});

test("8/K. the reconciliation-retry path issues NO FusionSolar mode-change command (source scan of the whole path)", () => {
  const files = [
    "./reconciliation-retry.ts",
    "./reconciliation-retry-schedule.ts",
    "./daily-reconciliation.ts",
  ];
  const forbidden = [
    "/automation/fusionsolar/atlanta/zero-export",
    "/automation/fusionsolar/atlanta/no-limit",
    "enableZeroExport",
    "enableNoLimit",
    "setActivePowerControlMode",
    "AutomationService.execute",
  ];

  for (const rel of files) {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    for (const token of forbidden) {
      assert.ok(
        !src.includes(token),
        `${rel} must not reference ${JSON.stringify(token)} — reconciliation must never write FusionSolar state`,
      );
    }
  }

  // The ONLY Automation Service endpoint the reconciliation path calls is the read-only status one.
  const recon = readFileSync(
    fileURLToPath(new URL("./daily-reconciliation.ts", import.meta.url)),
    "utf8",
  );
  const serviceCalls = recon.match(/\/automation\/fusionsolar\/atlanta\/[a-z-]+/g) ?? [];
  assert.deepEqual([...new Set(serviceCalls)], ["/automation/fusionsolar/atlanta/status"]);
});
