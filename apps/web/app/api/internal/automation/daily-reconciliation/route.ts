import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { runDailyReconciliation } from "@/lib/automation/daily-reconciliation";
import { recordSchedulerRun } from "@/lib/admin/scheduler-run";

const SCHEDULER_NAME = "automation_reconciliation";

/**
 * The Scaleway systemd timer's HTTP entry point for the Market Price
 * Optimization Execution Engine's daily reconciliation
 * (`voltessa-automation-reconciliation.timer`,
 * `OnCalendar=06:00:00 Europe/Sofia`). Bearer-token gated (`CRON_SECRET`),
 * same convention as every other `app/api/internal/**` route.
 *
 * This is the one job in the whole execution engine that reads
 * FusionSolar's real state (via the existing Automation Service's Read
 * Status operation) and compares it against Voltessa's own stored state -
 * see lib/automation/daily-reconciliation.ts.
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
    const outcomes = await runDailyReconciliation();

    console.log("[Automation Daily Reconciliation] Completed", {
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      outcomes,
    });

    await recordSchedulerRun({
      schedulerName: SCHEDULER_NAME,
      startedAt,
      status: "SUCCESS",
      summary: { outcomes },
    });

    return NextResponse.json({ ok: true, outcomes });
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
