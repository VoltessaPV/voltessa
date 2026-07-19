import crypto from "node:crypto";

import { NextResponse } from "next/server";

import {
  backfillMarketPrices,
  refreshMarketPrices,
} from "@/lib/market-price/refresh-market-prices";

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
    const daysParam = new URL(request.url).searchParams.get("days");
    const daysBack =
      daysParam !== null && Number.isFinite(Number(daysParam)) && Number(daysParam) > 0
        ? Number(daysParam)
        : undefined;

    // `?days=N`: backfill N complete Bulgaria-local days plus today (added
    // for the Historical Backfill + Timeline Alignment milestone). Omitted
    // entirely: unchanged single-day "today" refresh, the original
    // behavior every existing scheduled caller relies on.
    const result =
      daysBack !== undefined
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
