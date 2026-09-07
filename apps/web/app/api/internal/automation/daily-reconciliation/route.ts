import crypto from "node:crypto";

import { NextResponse } from "next/server";

import {
  aggregateMorningReconciliationStatus,
  runAtlantaMorningReconciliation,
} from "@/lib/automation/reconciliation-retry";
import { recordSchedulerRun } from "@/lib/admin/scheduler-run";

const SCHEDULER_NAME = "automation_reconciliation";

/**
 * The Scaleway systemd timer's HTTP entry point for the Market Price
 * Optimization Execution Engine's daily reconciliation
 * (`voltessa-automation-reconciliation.timer`). Bearer-token gated
 * (`CRON_SECRET`), same convention as every other `app/api/internal/**`
 * route.
 *
 * "Reconciliation retry" change: the timer now fires this route five times
 * every morning — 06:00, 06:15, 06:30, 06:45, 07:00 Europe/Sofia (see
 * `docs/infrastructure/scaleway-production.md`). Each invocation is
 * idempotent: `runAtlantaMorningReconciliation` uses the persisted
 * `AutomationReconciliationAttempt` row to run one read-only verification
 * attempt per slot, stop once an attempt has verified the real FusionSolar
 * state, and send exactly one Atlanta failure notification if the 07:00
 * attempt still failed. It never issues a FusionSolar command and never
 * writes `AutomationState.currentExportMode` except via the PR1
 * verified-sync path (`lib/automation/daily-reconciliation.ts`).
 */

export const runtime = "nodejs";
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

function secretsMatch(providedSecret: string, expectedSecret: string): boolean {
  const provided = Buffer.from(providedSecret);
  const expected = Buffer.from(expectedSecret);

  return (
    provided.length === expected.length &&
    crypto.timingSafeEqual(provided, expected)
  );
}

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return false;
  }

  const authorization = request.headers.get("authorization");

  if (!authorization || !authorization.startsWith("Bearer ")) {
    return false;
  }

  const providedSecret = authorization.slice("Bearer ".length);

  return secretsMatch(providedSecret, cronSecret);
}

async function handleReconciliation(request: Request) {
  if (!process.env.CRON_SECRET) {
    console.error(
      "[Automation Daily Reconciliation] CRON_SECRET is not configured",
    );

    return NextResponse.json(
      { ok: false, error: "server_not_configured" },
      { status: 500 },
    );
  }

  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();

  console.log("[Automation Daily Reconciliation] Starting scheduled execution", {
    startedAt: startedAt.toISOString(),
  });

  try {
    // One morning "slot" per invocation. Idempotent, persisted-state
    // driven, fail-closed: an attempt that could not VERIFY the real
    // FusionSolar state (Automation Service / Playwright / login / timeout /
    // network failure, inconsistent dongles) is FAILED, never SUCCESS; a
    // slot held off only by a still-running prior attempt is SKIPPED; a
    // verifying or no-op (outside-window / already-verified) tick is
    // SUCCESS. The single "could not be completed after all attempts"
    // notification fires only when the 07:00 slot itself fails.
    const results = await runAtlantaMorningReconciliation();
    const { status, errorMessage } = aggregateMorningReconciliationStatus(results);

    console.log("[Automation Daily Reconciliation] Completed", {
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      status,
      results,
    });

    await recordSchedulerRun({
      schedulerName: SCHEDULER_NAME,
      startedAt,
      status,
      errorMessage,
      summary: { status, results },
    });

    return NextResponse.json({ ok: true, status, results });
  } catch (error) {
    console.error("[Automation Daily Reconciliation] Failed", {
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      error,
    });

    await recordSchedulerRun({
      schedulerName: SCHEDULER_NAME,
      startedAt,
      status: "FAILED",
      errorMessage: error instanceof Error ? error.message : "unknown_error",
    });

    return NextResponse.json(
      {
        ok: false,
        error: "automation_daily_reconciliation_failed",
        reason: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handleReconciliation(request);
}

export async function POST(request: Request) {
  return handleReconciliation(request);
}
