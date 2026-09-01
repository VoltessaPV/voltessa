import crypto from "node:crypto";

import { NextResponse } from "next/server";

import {
  backfillMarketPrices,
  refreshMarketPrices,
  refreshTomorrowWithTrailingRecovery,
} from "@/lib/market-price/refresh-market-prices";
import { recordSchedulerRun } from "@/lib/admin/scheduler-run";

const SCHEDULER_NAME = "market_price_refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function secretsMatch(
  providedSecret: string,
  expectedSecret: string,
): boolean {
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

async function handleRefresh(request: Request) {
  if (!process.env.CRON_SECRET) {
    console.error(
      "[Market Price Refresh] CRON_SECRET is not configured",
    );

    return NextResponse.json(
      {
        ok: false,
        error: "server_not_configured",
      },
      {
        status: 500,
      },
    );
  }

  if (!isAuthorized(request)) {
    return NextResponse.json(
      {
        ok: false,
        error: "unauthorized",
      },
      {
        status: 401,
      },
    );
  }

  const startedAt = new Date();

  console.log("[Market Price Refresh] Starting scheduled execution", {
    startedAt: startedAt.toISOString(),
  });

  try {
    const params = new URL(request.url).searchParams;
    const daysParam = params.get("days");
    const daysBack =
      daysParam !== null && Number.isFinite(Number(daysParam)) && Number(daysParam) > 0
        ? Number(daysParam)
        : undefined;

    // `?target=tomorrow`: refresh the next Brussels/CET calendar day's
    // day-ahead prices instead of today's - added for the Scheduler
    // refinement milestone, which polls for tomorrow's prices starting at
    // 14:00 Europe/Sofia (shortly after ENTSO-E's real publication time)
    // rather than waiting until they've become "today". Purely a caller-
    // side choice of `referenceDate` - `refreshMarketPrices` itself already
    // accepted an arbitrary reference date and is otherwise unchanged.
    const targetsTomorrow = params.get("target") === "tomorrow";

    // `?days=N`: backfill N complete Bulgaria-local days plus today (added
    // for the Historical Backfill + Timeline Alignment milestone). Omitted
    // entirely: unchanged single-day "today" refresh, the original
    // behavior every existing scheduled caller relies on.
    //
    // `target=tomorrow` uses `refreshTomorrowWithTrailingRecovery`, which
    // always attempts the trailing 2-day recovery sweep (see
    // `recoverRecentIncompleteDays`'s own doc comment) even when the
    // primary "tomorrow" import itself fails (e.g. a sustained ENTSO-E
    // outage) - never for a manual/backfill call (`?days=N` or a bare
    // call), only for this scheduled path. A primary-import failure is
    // still rethrown after recovery has been attempted, so it's handled by
    // the existing catch block below exactly as before.
    let recovery: { imported: boolean; errors: string[] } | null = null;

    const result = targetsTomorrow
      ? await (async () => {
          const outcome = await refreshTomorrowWithTrailingRecovery();
          recovery = outcome.recovery;

          if (outcome.recoveryError) {
            console.error("[Market Price Refresh] Trailing-day recovery sweep failed unexpectedly", {
              startedAt: startedAt.toISOString(),
              error: outcome.recoveryError,
            });
          } else if (recovery) {
            console.log("[Market Price Refresh] Trailing-day recovery sweep", {
              startedAt: startedAt.toISOString(),
              ...recovery,
            });
          }

          return outcome.result;
        })()
      : daysBack !== undefined
        ? await backfillMarketPrices(daysBack)
        : await refreshMarketPrices();

    console.log("[Market Price Refresh] Completed", {
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      ...result,
    });

    await recordSchedulerRun({
      schedulerName: SCHEDULER_NAME,
      startedAt,
      status: "SUCCESS",
      summary: recovery ? { ...result, recovery } : result,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      ...(recovery ? { recovery } : {}),
    });
  } catch (error) {
    console.error("[Market Price Refresh] Failed", {
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
        error: "market_price_refresh_failed",
        reason: error instanceof Error ? error.message : "unknown_error",
      },
      {
        status: 500,
      },
    );
  }
}

export async function GET(request: Request) {
  return handleRefresh(request);
}

export async function POST(request: Request) {
  return handleRefresh(request);
}
