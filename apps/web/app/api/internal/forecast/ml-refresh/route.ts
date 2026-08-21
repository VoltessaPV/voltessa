import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { recordSchedulerRun } from "@/lib/admin/scheduler-run";
import { prisma } from "@/lib/prisma";
import { persistMlForecast, reconcileMlForecastActuals } from "@/lib/forecast/ml/ml-persistence";

/**
 * D+1 Self-Learning Forecast milestone. The ML pipeline's own scheduled
 * entry point — mirrors `app/api/internal/forecast/refresh/route.ts`'s
 * shape exactly (reconcile-then-generate, `CRON_SECRET`-gated,
 * per-plant-independent failure handling) but writes to `MlForecastRecord`
 * via the current CHAMPION model, never touching `PvForecastRecord` or
 * the existing physical+hand-tuned pipeline.
 *
 * Runs on `voltessa-ml-forecast-refresh.timer` (Scaleway VM, twice daily,
 * 5 minutes after the physical `voltessa-forecast-refresh.timer`) — see
 * `docs/infrastructure/scaleway-production.md`. (Historical note: this
 * comment previously said the timer did not exist yet; it was created on
 * the VM without this comment being updated to match — a documentation
 * lag now corrected, see the Continuous Retraining Loop milestone.)
 */

export const runtime = "nodejs";
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

function secretsMatch(providedSecret: string, expectedSecret: string): boolean {
  const provided = Buffer.from(providedSecret);
  const expected = Buffer.from(expectedSecret);
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const authorization = request.headers.get("authorization");
  if (!authorization || !authorization.startsWith("Bearer ")) return false;
  return secretsMatch(authorization.slice("Bearer ".length), cronSecret);
}

type PlantRunResult =
  | { plantId: string; ok: true; reconciledCount: number; persistedCount: number; modelVersionId: string }
  | { plantId: string; ok: true; skipped: "no_champion" }
  | { plantId: string; ok: false; error: string };

async function handleMlRefresh(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "server_not_configured" }, { status: 500 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();

  try {
    const plants = await prisma.plant.findMany({
      where: { latitude: { not: null }, longitude: { not: null }, capacityKw: { not: null } },
      select: { id: true, organizationId: true, latitude: true, longitude: true, capacityKw: true },
    });

    const results: PlantRunResult[] = [];

    for (const plant of plants) {
      const latitude = plant.latitude!.toNumber();
      const longitude = plant.longitude!.toNumber();
      const capacityKw = plant.capacityKw!.toNumber();

      try {
        const reconciledCount = await reconcileMlForecastActuals({ plantId: plant.id, organizationId: plant.organizationId });

        const issuedAt = new Date();
        const persisted = await persistMlForecast({
          plantId: plant.id,
          organizationId: plant.organizationId,
          latitude,
          longitude,
          capacityKw,
          issuedAt,
        });

        if (!persisted) {
          results.push({ plantId: plant.id, ok: true, skipped: "no_champion" });
          continue;
        }

        results.push({
          plantId: plant.id,
          ok: true,
          reconciledCount,
          persistedCount: persisted.persistedCount,
          modelVersionId: persisted.modelVersionId,
        });
      } catch (error) {
        results.push({ plantId: plant.id, ok: false, error: error instanceof Error ? error.message : "unknown_error" });
      }
    }

    const failures = results.filter((r) => !r.ok);

    await recordSchedulerRun({
      schedulerName: "ml_forecast_refresh",
      startedAt,
      status: failures.length === 0 ? "SUCCESS" : "FAILED",
      errorMessage: failures.length > 0 ? failures.map((f) => (!f.ok ? f.error : "")).join("; ") : undefined,
      summary: { plantsProcessed: results.length, results },
    });

    return NextResponse.json({ ok: failures.length === 0, plantsProcessed: results.length, results });
  } catch (error) {
    await recordSchedulerRun({
      schedulerName: "ml_forecast_refresh",
      startedAt,
      status: "FAILED",
      errorMessage: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json(
      { ok: false, error: "ml_forecast_refresh_failed", reason: error instanceof Error ? error.message : "unknown_error" },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handleMlRefresh(request);
}

export async function POST(request: Request) {
  return handleMlRefresh(request);
}
