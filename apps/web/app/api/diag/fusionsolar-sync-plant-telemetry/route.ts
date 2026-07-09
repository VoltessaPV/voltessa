import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { syncFusionSolarPlantTelemetry } from "@/lib/fusionsolar/sync-plant-telemetry";
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
    const result =
      await syncFusionSolarPlantTelemetry(
        user.organizationId,
        connection,
      );

    const latestSnapshots =
      await prisma.plantTelemetrySnapshot.findMany({
        where: {
          plant: {
            organizationId: user.organizationId,
          },
        },
        orderBy: {
          collectedAt: "desc",
        },
        take: 10,
        select: {
          id: true,
          totalIncome: true,
          totalPower: true,
          dayOnGridEnergy: true,
          dayPower: true,
          dayUseEnergy: true,
          dayIncome: true,
          realHealthState: true,
          monthPower: true,
          collectedAt: true,
          plant: {
            select: {
              name: true,
              stationCode: true,
            },
          },
        },
      });

    return NextResponse.json({
      ok: true,
      plantsRequested: result.plantsRequested,
      snapshotsCreated: result.snapshotsCreated,
      latestSnapshots,
    });
  } catch (error) {
    console.error(
      "[FusionSolar Plant Telemetry Sync Diagnostic] Failed",
      {
        organizationId: user.organizationId,
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
              }
            : String(error),
      },
    );

    return NextResponse.json(
      {
        ok: false,
        error: "fusionsolar_plant_telemetry_sync_failed",
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
