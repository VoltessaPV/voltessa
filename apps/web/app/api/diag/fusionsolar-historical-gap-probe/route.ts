import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { FusionSolarApiError } from "@/lib/fusionsolar/api-client";
import { importDeviceTelemetry } from "@/lib/fusionsolar/import-device-telemetry";
import { localDayBoundsUtc } from "@/lib/market-price/timezone";
import { prisma } from "@/lib/prisma";

/**
 * TEMPORARY diagnostic route - "why is Jan-Apr 2026 telemetry missing"
 * investigation. Calls the real, unmodified `importDeviceTelemetry` for a
 * single specific historical day, so the exact real Huawei response (data,
 * empty, or a specific error) is observed directly - never guessed. Removed
 * before this milestone ships.
 */

export const runtime = "nodejs";
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

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

  const params = new URL(request.url).searchParams;
  const dateStr = params.get("date") ?? "2026-01-15";

  const connection = await prisma.fusionSolarConnection.findUnique({
    where: { organizationId_provider: { organizationId: user.organizationId, provider: "HuaweiFusionSolar" } },
    select: { id: true, accessToken: true, refreshToken: true, tokenType: true, scope: true, expiresAt: true },
  });
  if (!connection) {
    return NextResponse.json({ ok: false, error: "no_connection" }, { status: 404 });
  }

  const plant = await prisma.plant.findFirst({
    where: { organizationId: user.organizationId, vendor: "Huawei" },
    select: { id: true },
  });
  if (!plant) {
    return NextResponse.json({ ok: false, error: "no_plant" }, { status: 404 });
  }

  const { start, end } = localDayBoundsUtc(new Date(`${dateStr}T12:00:00Z`), "Europe/Sofia");

  try {
    const result = await importDeviceTelemetry({
      connection,
      organizationId: user.organizationId,
      plantId: plant.id,
      windowStart: start,
      windowEnd: end,
    });

    return NextResponse.json({ ok: true, dateStr, windowStart: start, windowEnd: end, result });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      dateStr,
      errorName: error instanceof Error ? error.name : "unknown",
      errorMessage: error instanceof Error ? error.message : String(error),
      httpStatus: error instanceof FusionSolarApiError ? error.httpStatus : null,
      failCode: error instanceof FusionSolarApiError ? error.failCode : null,
      rawResponse: error instanceof FusionSolarApiError ? error.response : null,
    });
  }
}
