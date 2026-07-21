import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  synchronizeFusionSolarConnection,
  type SynchronizeFusionSolarConnectionResult,
} from "@/lib/fusionsolar/telemetry-sync-service";

/**
 * The Scaleway systemd timer's HTTP entry point (`voltessa-telemetry-
 * ingestion.timer`, `OnCalendar=*:0/5`, ADR-008/ADR-009). URL unchanged —
 * this is an externally-configured contract the VM's timer/service files
 * depend on. Bearer-token gated (`CRON_SECRET`), same convention as
 * `ingest-plant-telemetry`.
 *
 * Database-First Telemetry Architecture milestone: this route no longer
 * synchronizes anything itself. It enumerates every `FusionSolarConnection`
 * and delegates to `synchronizeFusionSolarConnection` — the single
 * synchronization entry point the whole application shares (see
 * `lib/fusionsolar/telemetry-sync-service.ts`). Deliberately called
 * *without* `force`: the scheduler is not special-cased — it goes through
 * the identical freshness gate as a Dashboard/Market render or the manual
 * Refresh action. `FUSIONSOLAR_SYNC_FRESHNESS_MS` is chosen so the
 * unchanged 5-minute cron still performs a real sync on effectively every
 * tick this milestone; only that one shared constant governs how often
 * Huawei is actually contacted, from any caller.
 *
 * NOT wired to Vercel's native `crons` config — confirmed blocked on this
 * plan tier (see `docs/research/telemetry-consumer-migration.md` §11 and
 * `docs/research/telemetry-platform-foundation.md` §8 for the full
 * history); this Scaleway-hosted timer is the one production scheduler.
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

type ConnectionSyncSummary = {
  connectionId: string;
  organizationId: string;
} & SynchronizeFusionSolarConnectionResult;

async function handleBootstrap(request: Request) {
  if (!process.env.CRON_SECRET) {
    console.error(
      "[FusionSolar Telemetry Sync] CRON_SECRET is not configured",
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

  console.log("[FusionSolar Telemetry Sync] Starting scheduled execution", {
    startedAt: startedAt.toISOString(),
  });

  try {
    const connections = await prisma.fusionSolarConnection.findMany({
      where: { provider: "HuaweiFusionSolar" },
      select: { id: true, organizationId: true },
    });

    const results: ConnectionSyncSummary[] = [];

    for (const connection of connections) {
      const result = await synchronizeFusionSolarConnection(connection.id);

      results.push({
        connectionId: connection.id,
        organizationId: connection.organizationId,
        ...result,
      });
    }

    const failures = results.filter((result) => result.status === "failed");

    console.log("[FusionSolar Telemetry Sync] Completed", {
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      connectionsProcessed: results.length,
      results,
    });

    return NextResponse.json({
      ok: failures.length === 0,
      connectionsProcessed: results.length,
      results,
    });
  } catch (error) {
    console.error("[FusionSolar Telemetry Sync] Failed", {
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      error,
    });

    return NextResponse.json(
      {
        ok: false,
        error: "fusionsolar_telemetry_sync_failed",
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
