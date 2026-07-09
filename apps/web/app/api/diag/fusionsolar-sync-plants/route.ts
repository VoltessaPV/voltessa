import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { syncFusionSolarPlants } from "@/lib/fusionsolar/sync-plants";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

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
    const result = await syncFusionSolarPlants(
      user.organizationId,
      connection,
    );

    const plants = await prisma.plant.findMany({
      where: {
        organizationId: user.organizationId,
        vendor: "Huawei",
      },
      orderBy: {
        name: "asc",
      },
      select: {
        id: true,
        name: true,
        vendor: true,
        stationCode: true,
        plantCode: true,
        capacityKw: true,
        latitude: true,
        longitude: true,
        address: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      ok: true,
      synced: result.synced,
      plantCount: plants.length,
      plants,
    });
  } catch (error) {
    console.error("[FusionSolar Plant Sync Diagnostic] Failed", {
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
        error: "fusionsolar_plant_sync_failed",
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
