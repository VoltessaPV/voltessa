import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getActivePowerControlMode } from "@/lib/fusionsolar/get-active-power-control-mode";
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

  const plant = await prisma.plant.findFirst({
    where: {
      organizationId: user.organizationId,
      vendor: "Huawei",
      plantCode: {
        not: null,
      },
    },
    select: {
      id: true,
      name: true,
      plantCode: true,
    },
  });

  if (!plant?.plantCode) {
    return NextResponse.json(
      {
        ok: false,
        error: "plant_not_found",
      },
      {
        status: 404,
      },
    );
  }

  try {
    const result = await getActivePowerControlMode(
      connection,
      plant.plantCode,
    );

    return NextResponse.json({
      ok: true,
      plantId: plant.id,
      plantName: plant.name,
      plantCode: plant.plantCode,
      activePowerControlMode: result,
    });
  } catch (error) {
    console.error(
      "[FusionSolar Active Power Control Diagnostic] Failed",
      {
        organizationId: user.organizationId,
        plantCode: plant.plantCode,
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
        error:
          "fusionsolar_active_power_control_diagnostic_failed",
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
