import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { bootstrapDeviceTelemetry } from "@/lib/fusionsolar/bootstrap-device-telemetry";

/**
 * Continuous ingestion of the DeviceTelemetry table (today + yesterday
 * only) for every organization with a FusionSolar connection. Scheduled via
 * `vercel.json`'s `crons` entry (every 15 minutes) — Vercel automatically
 * sends `Authorization: Bearer $CRON_SECRET` for cron-triggered requests,
 * so no separate cron-specific auth path is needed. Still callable
 * manually with the same bearer token (e.g. for a one-off bootstrap or
 * backfill) — same bearer-token convention as `ingest-plant-telemetry`.
 *
 * Idempotent: `bootstrapDeviceTelemetry` -> `importDeviceTelemetry` writes
 * via `createMany({ skipDuplicates: true })`, so re-running every 15
 * minutes never duplicates a row — each run only ever inserts whatever is
 * genuinely new since the last run.
 *
 * A previous attempt at this exact schedule (commit `6643255`) was
 * reverted (`853893d`) with no recorded reason. Re-attempted here per an
 * explicit milestone requirement ("DeviceTelemetry must always stay within
 * approximately one telemetry interval of the current local time") —
 * verify the deployment succeeds; if Vercel rejects this specific cron
 * frequency (a plan-tier limit, not a code issue), that will surface as a
 * deployment/build error, not a runtime one.
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

async function handleBootstrap(request: Request) {
  if (!process.env.CRON_SECRET) {
    console.error(
      "[FusionSolar Device Telemetry Bootstrap] CRON_SECRET is not configured",
    );

    return NextResponse.json(
      { ok: false, error: "server_not_configured" },
      { status: 500 },
    );
  }

  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await bootstrapDeviceTelemetry();

    return NextResponse.json({
      ok: result.organizationsFailed === 0,
      ...result,
    });
  } catch (error) {
    console.error("[FusionSolar Device Telemetry Bootstrap] Failed", { error });

    return NextResponse.json(
      {
        ok: false,
        error: "fusionsolar_device_telemetry_bootstrap_failed",
        reason: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handleBootstrap(request);
}

export async function POST(request: Request) {
  return handleBootstrap(request);
}
