import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { syncFusionSolarDevices } from "@/lib/fusionsolar/sync-devices";
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
    const result = await syncFusionSolarDevices(
      user.organizationId,
      connection,
    );

    const devices = await prisma.device.findMany({
      where: {
        plant: {
          organizationId: user.organizationId,
        },
        vendor: "Huawei",
      },
      orderBy: [
        {
          plantId: "asc",
        },
        {
          devName: "asc",
        },
      ],
      select: {
        id: true,
        plantId: true,
        vendor: true,
        devDn: true,
        devName: true,
        devTypeId: true,
        esnCode: true,
        invType: true,
        model: true,
        optimizerNumber: true,
        softwareVersion: true,
        latitude: true,
        longitude: true,
        createdAt: true,
        updatedAt: true,
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
      plantsProcessed: result.plantsProcessed,
      devicesSynced: result.devicesSynced,
      deviceCount: devices.length,
      devices,
    });
  } catch (error) {
    console.error("[FusionSolar Device Sync Diagnostic] Failed", {
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
        error: "fusionsolar_device_sync_failed",
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
