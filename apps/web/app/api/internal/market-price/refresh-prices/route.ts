import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { refreshMarketPrices } from "@/lib/market-price/refresh-market-prices";

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

  try {
    const result = await refreshMarketPrices();

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("[Market Price Refresh] Failed", { error });

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
