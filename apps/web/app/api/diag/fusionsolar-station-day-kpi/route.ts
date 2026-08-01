import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getFusionSolarStationDayKpi } from "@/lib/fusionsolar/station-day-kpi";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

/**
 * Temporary diagnostic route — Historical Data Auto-Import milestone,
 * Phase 0. Inspects a real `getKpiStationDay` response against production so
 * the exact `dataItemMap` field names can be confirmed and mapped to
 * `PlantDailyKpi` before any import code is written against a guessed
 * shape. Delete this route once that mapping is confirmed and documented
 * (see `lib/fusionsolar/station-day-kpi.ts`) — never wired into any
 * scheduled or user-facing path. Mirrors `fusionsolar-plant-realtime`'s
 * existing diag-route auth pattern exactly.
 */
export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { organizationId: true },
  });

  if (!user?.organizationId) {
    return NextResponse.json({ ok: false, error: "organization_not_found" }, { status: 404 });
  }

  const connection = await prisma.fusionSolarConnection.findUnique({
    where: {
      organizationId_provider: { organizationId: user.organizationId, provider: "HuaweiFusionSolar" },
    },
    select: {
      id: true,
      accessToken: true,
      refreshToken: true,
      tokenType: true,
      scope: true,
      expiresAt: true,
    },
  });

  if (!connection) {
    return NextResponse.json({ ok: false, error: "fusionsolar_connection_not_found" }, { status: 404 });
  }

  const plant = await prisma.plant.findFirst({
    where: { organizationId: user.organizationId, vendor: "Huawei", stationCode: { not: null } },
    select: { stationCode: true },
  });

  if (!plant?.stationCode) {
    return NextResponse.json({ ok: false, error: "plant_not_found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const collectTimeParam = url.searchParams.get("collectTime");
  const collectTime = collectTimeParam ? Number(collectTimeParam) : Date.now();

  if (!Number.isFinite(collectTime)) {
    return NextResponse.json({ ok: false, error: "invalid_collect_time" }, { status: 400 });
  }

  try {
    const data = await getFusionSolarStationDayKpi(connection, {
      stationCode: plant.stationCode,
      collectTime,
    });

    console.log(
      "[diag/fusionsolar-station-day-kpi] raw getKpiStationDay response",
      JSON.stringify({ stationCode: plant.stationCode, collectTime, data }),
    );

    return NextResponse.json({
      ok: true,
      stationCode: plant.stationCode,
      collectTime,
      collectTimeIso: new Date(collectTime).toISOString(),
      data,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "fusionsolar_station_day_kpi_failed",
        reason: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 502 },
    );
  }
}
