import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { callFusionSolarApi } from "@/lib/fusionsolar/api-client";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

type FusionSolarPlant = {
  plantCode: string;
  plantName: string;
  plantAddress: string | null;
  longitude: number | null;
  latitude: number | null;
  capacity: number;
  contactPerson: string | null;
  contactMethod: string | null;
  gridConnectionDate: string | null;
};

type FusionSolarPlantListData = {
  list: FusionSolarPlant[];
  pageCount: number;
  pageNo: number;
  pageSize: number;
  total: number;
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
    const result =
      await callFusionSolarApi<FusionSolarPlantListData>(
        connection,
        {
          path: "/thirdData/stations",
          body: {
            pageNo: 1,
          },
        },
      );

    return NextResponse.json({
      ok: true,
      tokenRefreshed: result.tokenRefreshed,
      plantCount: result.data.list.length,
      total: result.data.total,
      plants: result.data.list,
    });
  } catch (error) {
    console.error("[FusionSolar Stations Diagnostic] Failed", {
      organizationId: user.organizationId,
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
        error: "fusionsolar_stations_diagnostic_failed",
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
