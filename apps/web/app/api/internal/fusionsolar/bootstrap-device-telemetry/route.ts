import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { bootstrapDeviceTelemetry } from "@/lib/fusionsolar/bootstrap-device-telemetry";

/**
 * Manual/externally-triggered ingestion of the DeviceTelemetry table
 * (today + yesterday by default) for every organization with a FusionSolar
 * connection. Bearer-token gated (`CRON_SECRET`), same convention as
 * `ingest-plant-telemetry`. Idempotent: `bootstrapDeviceTelemetry` ->
 * `importDeviceTelemetry` writes via `createMany({ skipDuplicates: true })`,
 * so calling this any number of times never duplicates a row.
 *
 * Accepts an optional `?days=N` query parameter (complete local
 * Europe/Sofia calendar days to backfill, plus today) — added for the
 * Historical Backfill + Timeline Alignment milestone, which needed a
 * one-time 7-day-plus-today backfill without changing the default
 * "yesterday + today" shape any other caller relies on.
 *
 * NOT wired to Vercel's native `crons` config. Confirmed (not assumed) via
 * a real deployment attempt in the Telemetry Reliability & Market Chart
 * Completion milestone: adding a `crons` entry to `vercel.json` for this
 * route made the production deployment fail outright — the failure
 * shortlink Vercel attached to the failed GitHub status pointed directly
 * at `vercel.com/docs/cron-jobs/usage-and-pricing`, confirming a plan-tier
 * cron restriction, the same cause a prior identical attempt (commit
 * `6643255`, reverted as `853893d`) almost certainly hit. Continuous
 * ingestion therefore requires either upgrading the Vercel plan or an
 * external scheduler (e.g. a GitHub Actions cron workflow calling this
 * route with the real `CRON_SECRET` as a repository secret) — both are
 * manual account/cloud-configuration steps outside what this codebase
 * alone can decide or perform. See
 * docs/research/telemetry-consumer-migration.md for the full writeup.
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
    const daysParam = new URL(request.url).searchParams.get("days");
    const daysBack =
      daysParam !== null && Number.isFinite(Number(daysParam)) && Number(daysParam) > 0
        ? Number(daysParam)
        : undefined;

    const result = await bootstrapDeviceTelemetry(daysBack);

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
