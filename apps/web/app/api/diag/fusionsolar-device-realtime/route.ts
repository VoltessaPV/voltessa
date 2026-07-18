import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { FusionSolarApiError } from "@/lib/fusionsolar/api-client";
import { getFusionSolarDeviceRealTimeKpi } from "@/lib/fusionsolar/device-real-time-kpi";
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

  const devices = await prisma.device.findMany({
    where: {
      plant: {
        organizationId: user.organizationId,
      },
    },
    select: {
      id: true,
      devDn: true,
      devName: true,
      devTypeId: true,
      huaweiDeviceId: true,
      esnCode: true,
      model: true,
      plantId: true,
      plant: {
        select: {
          name: true,
          stationCode: true,
        },
      },
    },
  });

  const devicesMissingHuaweiDeviceId = devices
    .filter((device) => device.huaweiDeviceId === null)
    .map((device) => ({
      id: device.id,
      devDn: device.devDn,
      devName: device.devName,
      devTypeId: device.devTypeId,
      plantId: device.plantId,
      plantName: device.plant.name,
    }));

  const devicesByTypeId = new Map<
    number,
    typeof devices
  >();

  for (const device of devices) {
    if (device.huaweiDeviceId === null) {
      continue;
    }

    const group = devicesByTypeId.get(device.devTypeId) ?? [];

    group.push(device);
    devicesByTypeId.set(device.devTypeId, group);
  }

  const realtimeByDevTypeId: Record<string, unknown> = {};

  for (const [devTypeId, group] of devicesByTypeId) {
    const devIds = group
      .map((device) => device.huaweiDeviceId?.toString())
      .filter((devId): devId is string => Boolean(devId))
      .join(",");

    if (!devIds) {
      continue;
    }

    const devicesInGroup = group.map((device) => ({
      id: device.id,
      devDn: device.devDn,
      devName: device.devName,
      huaweiDeviceId: device.huaweiDeviceId?.toString(),
      esnCode: device.esnCode,
      model: device.model,
      plantId: device.plantId,
      plantName: device.plant.name,
    }));

    try {
      const data = await getFusionSolarDeviceRealTimeKpi(
        connection,
        devTypeId,
        devIds,
      );

      realtimeByDevTypeId[String(devTypeId)] = {
        devTypeId,
        devIds,
        devices: devicesInGroup,
        ok: true,
        getDevRealKpi: data,
      };
    } catch (error) {
      if (error instanceof FusionSolarApiError) {
        realtimeByDevTypeId[String(devTypeId)] = {
          devTypeId,
          devIds,
          devices: devicesInGroup,
          ok: false,
          upstream: {
            httpStatus: error.httpStatus,
            failCode: error.failCode,
            message: error.message,
            responseBody: error.response,
          },
        };
      } else {
        realtimeByDevTypeId[String(devTypeId)] = {
          devTypeId,
          devIds,
          devices: devicesInGroup,
          ok: false,
          reason:
            error instanceof Error
              ? error.message
              : String(error),
        };
      }
    }
  }

  return NextResponse.json({
    ok: true,
    organizationId: user.organizationId,
    deviceCount: devices.length,
    devicesMissingHuaweiDeviceId,
    realtimeByDevTypeId,
  });
}
