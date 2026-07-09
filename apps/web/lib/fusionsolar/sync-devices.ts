import { Prisma } from "@prisma/client";

import {
  callFusionSolarApi,
  type FusionSolarConnection,
} from "@/lib/fusionsolar/api-client";
import { prisma } from "@/lib/prisma";

type FusionSolarDevice = {
  id: number;
  devDn: string;
  devName: string;
  devTypeId: number;
  esnCode: string | null;
  invType: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  model: string | null;
  optimizerNumber: number | null;
  softwareVersion: string | null;
  stationCode: string;
};

function toDecimal(
  value: number | string | null,
): Prisma.Decimal | null {
  if (value === null || value === "") {
    return null;
  }

  try {
    return new Prisma.Decimal(value);
  } catch {
    return null;
  }
}

function getDeviceData(device: FusionSolarDevice) {
  return {
    vendor: "Huawei",
    devDn: device.devDn,
    devName: device.devName,
    devTypeId: device.devTypeId,
    esnCode: device.esnCode,
    invType: device.invType,
    model: device.model,
    optimizerNumber: device.optimizerNumber,
    softwareVersion: device.softwareVersion,
    latitude: toDecimal(device.latitude),
    longitude: toDecimal(device.longitude),
  };
}

export async function syncFusionSolarDevices(
  organizationId: string,
  connection: FusionSolarConnection,
): Promise<{
  plantsProcessed: number;
  devicesSynced: number;
}> {
  const plants = await prisma.plant.findMany({
    where: {
      organizationId,
      vendor: "Huawei",
      stationCode: {
        not: null,
      },
    },
    select: {
      id: true,
      stationCode: true,
    },
  });

  let devicesSynced = 0;

  for (const plant of plants) {
    if (!plant.stationCode) {
      continue;
    }

    const result = await callFusionSolarApi<
      FusionSolarDevice[]
    >(connection, {
      path: "/thirdData/getDevList",
      body: {
        stationCodes: plant.stationCode,
      },
    });

    if (result.data.length === 0) {
      continue;
    }

    await prisma.$transaction(
      result.data.map((device) =>
        prisma.device.upsert({
          where: {
            plantId_devDn: {
              plantId: plant.id,
              devDn: device.devDn,
            },
          },
          create: {
            plantId: plant.id,
            ...getDeviceData(device),
          },
          update: getDeviceData(device),
        }),
      ),
    );

    devicesSynced += result.data.length;
  }

  return {
    plantsProcessed: plants.length,
    devicesSynced,
  };
}
