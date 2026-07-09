import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { callFusionSolarApi } from "@/lib/fusionsolar/api-client";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

const TEST_STATION_CODE = "NE=163554568";

export async function GET() {
  const session = await auth();

  if (!session?.user?.email) {
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

  const user = await prisma.user.findUnique({
    where: {
      email: session.user.email,
    },
    select: {
      organizationId: true,
    },
  });

  if (!user?.organizationId) {
    return NextResponse.json(
      {
        ok: false,
        error: "organization_not_found",
      },
      {
        status: 404,
      },
    );
  }

  const connection =
    await prisma.fusionSolarConnection.findUnique({
      where: {
        organizationId_provider: {
          organizationId: user.organizationId,
          provider: "HuaweiFusionSolar",
        },
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
    return NextResponse.json(
      {
        ok: false,
        error: "fusionsolar_connection_not_found",
      },
      {
        status: 404,
      },
    );
  }

  try {
    const result = await callFusionSolarApi<unknown>(
      connection,
      {
        path: "/thirdData/getStationRealKpi",
        body: {
          stationCodes: TEST_STATION_CODE,
        },
      },
    );

    return NextResponse.json({
      ok: true,
      stationCode: TEST_STATION_CODE,
      tokenRefreshed: result.tokenRefreshed,
      data: result.data,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "fusionsolar_plant_realtime_failed",
        reason:
          error instanceof Error
            ? error.message
            : "unknown_error",
      },
      {
        status: 502,
      },
    );
  }
}
