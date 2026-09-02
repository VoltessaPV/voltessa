import crypto from "node:crypto";

import { NextResponse } from "next/server";

import {
  backfillMarketPrices,
  computeRecoveryDeadline,
  refreshMarketPrices,
  refreshTomorrowWithTrailingRecovery,
  type MarketPriceRefreshResult,
  type RecoverySweepResult,
} from "@/lib/market-price/refresh-market-prices";
import { recordSchedulerRun } from "@/lib/admin/scheduler-run";
import { reportSchedulerOutcome, type MarketPriceRunStatus } from "@/lib/market-price/market-price-notifications";
import { ENTSOE_MARKET_TIMEZONE, formatDateInZone } from "@/lib/market-price/timezone";

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

  const params = new URL(request.url).searchParams;

  // `?target=tomorrow`: refresh the next Brussels/CET calendar day's
  // day-ahead prices instead of today's - added for the Scheduler
  // refinement milestone, which polls for tomorrow's prices starting at
  // 14:00 Europe/Sofia (shortly after ENTSO-E's real publication time)
  // rather than waiting until they've become "today". Purely a caller-side
  // choice of `referenceDate` - `refreshMarketPrices` itself already
  // accepted an arbitrary reference date and is otherwise unchanged.
  // Declared outside the try block so both the success and failure paths
  // below can scope incident alerting to this real scheduled path.
  const targetsTomorrow = params.get("target") === "tomorrow";
  const tomorrowReferenceDate = new Date(Date.now() + 24 * 60 * 60 * 1000);

  // Market Price Reliability milestone: the hard recovery-escalation
  // deadline for THIS delivery day (05:00 Europe/Sofia on its own
  // Bulgaria-local calendar date) - computed once so both branches below
  // classify against the exact same instant.
  const deadline = targetsTomorrow ? computeRecoveryDeadline(tomorrowReferenceDate) : null;

  try {
    const daysParam = params.get("days");
    const daysBack =
      daysParam !== null && Number.isFinite(Number(daysParam)) && Number(daysParam) > 0
        ? Number(daysParam)
        : undefined;

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
    let recovery: RecoverySweepResult | null = null;
    let recoveryFallbackUsed = false;
    let primaryUsedIbexFallback = false;

    const result = targetsTomorrow
      ? await (async () => {
          const outcome = await refreshTomorrowWithTrailingRecovery();
          recovery = outcome.recovery;
          recoveryFallbackUsed = outcome.recovery?.fallbackUsed ?? false;
          primaryUsedIbexFallback = outcome.primaryFallbackUsed;

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

    // Incident open/closed/escalated alerting (Market Price Reliability
    // milestone) - only for the real scheduled `target=tomorrow` path,
    // matching the trailing recovery sweep's own scoping above. Reported
    // BEFORE recordSchedulerRun so it reads the true previous runs, not the
    // one about to be written.
    //
    // The reported status reflects actual COMPLETENESS, not merely "did an
    // exception get thrown" - a run that returns without throwing but is
    // `isPartial` (some intervals missing) or `unavailable` (ENTSO-E hasn't
    // published this delivery day yet - routine, see
    // `EntsoeNoDataAvailableError`) must never be treated as the incident
    // closing, per "incomplete data must never be marked complete." This
    // also corrects `SchedulerRun.status` itself (previously always
    // "SUCCESS" whenever no exception was thrown, even for a partial or
    // not-yet-published result) - the same completeness rule
    // `isCetDayImportComplete` already uses elsewhere, applied consistently
    // here too.
    if (targetsTomorrow) {
      const tomorrowResult = result as MarketPriceRefreshResult;
      const runStatus: MarketPriceRunStatus = tomorrowResult.unavailable
        ? "SKIPPED"
        : tomorrowResult.isPartial
          ? "FAILED"
          : "SUCCESS";
      const reason = tomorrowResult.unavailable
        ? "ENTSO-E has not published this delivery day yet"
        : tomorrowResult.isPartial
          ? `Incomplete dataset: ${tomorrowResult.importedIntervals}/${tomorrowResult.expectedIntervals} intervals received`
          : null;

      // Scheduler Operational Resilience milestone: `result` may itself
      // already be IBEX-sourced (`primaryUsedIbexFallback`) if ENTSO-E
      // failed/was unavailable/left this exact delivery day partial this
      // cycle - that is an overall SUCCESS for the day, never reported as
      // a failure merely because ENTSO-E didn't provide it. The trailing
      // recovery sweep's own (separate day's) fallback usage is still
      // surfaced too, for observability, without being its own alert.
      const fallbackUsedThisCycle = primaryUsedIbexFallback || recoveryFallbackUsed;

      await reportSchedulerOutcome(
        SCHEDULER_NAME,
        {
          status: runStatus,
          startedAt,
          deliveryDate: formatDateInZone(tomorrowResult.periodStart, ENTSOE_MARKET_TIMEZONE),
          source: primaryUsedIbexFallback ? "IBEX" : "ENTSOE",
          expectedIntervals: tomorrowResult.expectedIntervals,
          importedIntervals: tomorrowResult.importedIntervals,
          reason,
          primarySource: "ENTSOE",
          fallbackAttempted: fallbackUsedThisCycle,
          fallbackSource: fallbackUsedThisCycle ? "IBEX" : null,
          finalStatus: runStatus === "SUCCESS" ? (primaryUsedIbexFallback ? "fallback" : "primary") : "failed",
        },
        deadline,
      );

      await recordSchedulerRun({
        schedulerName: SCHEDULER_NAME,
        startedAt,
        status: runStatus,
        errorMessage: reason ?? undefined,
        summary: recovery ? { ...result, recovery } : result,
      });
    } else {
      await recordSchedulerRun({
        schedulerName: SCHEDULER_NAME,
        startedAt,
        status: "SUCCESS",
        summary: recovery ? { ...result, recovery } : result,
      });
    }

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

    if (targetsTomorrow) {
      await reportSchedulerOutcome(
        SCHEDULER_NAME,
        {
          status: "FAILED",
          startedAt,
          deliveryDate: formatDateInZone(tomorrowReferenceDate, ENTSOE_MARKET_TIMEZONE),
          source: "ENTSOE",
          expectedIntervals: null,
          importedIntervals: null,
          reason: error instanceof Error ? error.message : "unknown_error",
          primarySource: "ENTSOE",
          finalStatus: "failed",
        },
        deadline,
      );
    }

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
