import crypto from "node:crypto";

import { NextResponse } from "next/server";

import {
  backfillMarketPrices,
  refreshMarketPrices,
} from "@/lib/market-price/refresh-market-prices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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
    const result = targetsTomorrow
      ? await refreshMarketPrices(new Date(Date.now() + ONE_DAY_MS))
      : daysBack !== undefined
        ? await backfillMarketPrices(daysBack)
        : await refreshMarketPrices();

    console.log("[Market Price Refresh] Completed", {
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      ...result,
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("[Market Price Refresh] Failed", {
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      error,
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
