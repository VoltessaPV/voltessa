import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { callFusionSolarApi } from "@/lib/fusionsolar/api-client";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

const TEST_STATION_CODE = "NE=163554568";

type FusionSolarDevice = {
  id: number;
  devDn: string;
  devName: string;
  devTypeId: number;
  esnCode: string | null;
  invType: string | null;
  latitude: number | null;
  longitude: number | null;
  model: string | null;
  optimizerNumber: number | null;
  softwareVersion: string | null;
  stationCode: string;
};

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
    const result = await callFusionSolarApi<
      FusionSolarDevice[]
    >(connection, {
      path: "/thirdData/getDevList",
      body: {
        stationCodes: TEST_STATION_CODE,
      },
    });

    return NextResponse.json({
      ok: true,
      stationCode: TEST_STATION_CODE,
      tokenRefreshed: result.tokenRefreshed,
      deviceCount: result.data.length,
      devices: result.data,
    });
  } catch (error) {
    console.error("[FusionSolar Devices Diagnostic] Failed", {
      organizationId: user.organizationId,
      stationCode: TEST_STATION_CODE,
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
            }
          : String(error),
    });

    return NextResponse.json(
      {
        ok: false,
        error: "fusionsolar_devices_diagnostic_failed",
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
