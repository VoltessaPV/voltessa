import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { recordSchedulerRun } from "@/lib/admin/scheduler-run";
import { DEFAULT_EXTENDED_HORIZON_DAYS, generatePvForecast } from "@/lib/forecast/pv-forecast-engine";
import { persistFullForecastVintage, reconcileForecastActuals } from "@/lib/forecast/forecast-persistence";
import { prisma } from "@/lib/prisma";

const SCHEDULER_NAME = "forecast_refresh";

/**
 * Dashboard Forecast Architecture Correction milestone. The Scaleway
 * systemd timer's HTTP entry point (`voltessa-forecast-refresh.timer`,
 * twice daily — see `docs/infrastructure/scaleway-production.md`). This is
 * now the ONLY place `generatePvForecast` (the expensive physical/weather/
 * calibration/analog/glide-path engine) ever runs — the Dashboard reads
 * only the persisted result (`lib/forecast/forecast-read.ts`), never
 * recomputes it. Bearer-token gated (`CRON_SECRET`), identical convention
 * to every other `app/api/internal/**` scheduler route.
 *
 * For every plant with configured coordinates + capacity (the same
 * `Plant.latitude`/`longitude`/`capacityKw` fields Solar Weather and the
 * old live forecast both already used — no new location source): first
 * reconcile any previously-persisted, now-elapsed forecast intervals
 * against real actuals (`reconstructAvailablePv`, never historical
 * export), then generate one fresh full-horizon vintage
 * (`DEFAULT_EXTENDED_HORIZON_DAYS`, ~35 days, every tier) and persist it in
 * full. One plant's failure never blocks another's — each is wrapped
 * independently, and the run is reported "ok" only if every plant
 * succeeded.
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

type PlantRunResult =
  | { plantId: string; ok: true; reconciledCount: number; persistedCount: number; intervalCount: number }
  | { plantId: string; ok: false; error: string };

async function handleRefresh(request: Request) {
  if (!process.env.CRON_SECRET) {
    console.error("[Forecast Refresh] CRON_SECRET is not configured");
    return NextResponse.json({ ok: false, error: "server_not_configured" }, { status: 500 });
  }

  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();
  console.log("[Forecast Refresh] Starting scheduled execution", { startedAt: startedAt.toISOString() });

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
        const reconciledCount = await reconcileForecastActuals({
          plantId: plant.id,
          organizationId: plant.organizationId,
        });

        const forecast = await generatePvForecast({
          plantId: plant.id,
          organizationId: plant.organizationId,
          latitude,
          longitude,
          capacityKw,
          horizonHours: DEFAULT_EXTENDED_HORIZON_DAYS * 24,
        });

        const persistedCount = await persistFullForecastVintage({
          plantId: plant.id,
          organizationId: plant.organizationId,
          forecast,
        });

        results.push({
          plantId: plant.id,
          ok: true,
          reconciledCount,
          persistedCount,
          intervalCount: forecast.intervals.length,
        });
      } catch (error) {
        results.push({
          plantId: plant.id,
          ok: false,
          error: error instanceof Error ? error.message : "unknown_error",
        });
      }
    }

    const failures = results.filter((result) => !result.ok);

    console.log("[Forecast Refresh] Completed", {
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      plantsProcessed: results.length,
      results,
    });

    await recordSchedulerRun({
      schedulerName: SCHEDULER_NAME,
      startedAt,
      status: failures.length === 0 ? "SUCCESS" : "FAILED",
      errorMessage:
        failures.length > 0
          ? failures.map((f) => (!f.ok ? f.error : "")).join("; ")
          : undefined,
      summary: { plantsProcessed: results.length, results },
    });

    return NextResponse.json({ ok: failures.length === 0, plantsProcessed: results.length, results });
  } catch (error) {
    console.error("[Forecast Refresh] Failed", {
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
      { ok: false, error: "forecast_refresh_failed", reason: error instanceof Error ? error.message : "unknown_error" },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handleRefresh(request);
}

export async function POST(request: Request) {
  return handleRefresh(request);
}
