import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { runMarketPriceOptimizationScheduler } from "@/lib/automation/market-price-optimization-scheduler";
import { recordSchedulerRun } from "@/lib/admin/scheduler-run";

const SCHEDULER_NAME = "automation_execution";

/**
 * The Scaleway systemd timer's HTTP entry point for the Market Price
 * Optimization Execution Engine's 15-minute cycle
 * (`voltessa-automation-execution.timer`, `OnCalendar=*:0/15`). Bearer-
 * token gated (`CRON_SECRET`), same convention as every other
 * `app/api/internal/**` route (see bootstrap-device-telemetry/route.ts,
 * market-price/refresh-prices/route.ts).
 *
 * Never queries FusionSolar directly - delegates entirely to
 * runMarketPriceOptimizationScheduler, which only calls the Automation
 * Service when a mode switch is actually required. See
 * daily-reconciliation/route.ts for the once-daily job that does read
 * FusionSolar's real state.
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

async function handleExecute(request: Request) {
  if (!process.env.CRON_SECRET) {
    console.error(
      "[Market Price Optimization] CRON_SECRET is not configured",
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

  console.log("[Market Price Optimization] Starting scheduled execution", {
    startedAt: startedAt.toISOString(),
  });

  try {
    const outcomes = await runMarketPriceOptimizationScheduler();

    console.log("[Market Price Optimization] Completed", {
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
    console.error("[Market Price Optimization] Failed", {
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
        error: "market_price_optimization_failed",
        reason: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handleExecute(request);
}

export async function POST(request: Request) {
  return handleExecute(request);
}
