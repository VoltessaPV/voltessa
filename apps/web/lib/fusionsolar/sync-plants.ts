import { Prisma } from "@prisma/client";

import type { FusionSolarConnection } from "@/lib/fusionsolar/api-client";
import {
  getAllFusionSolarPlants,
  type FusionSolarPlant,
} from "@/lib/fusionsolar/plants";
import { prisma } from "@/lib/prisma";

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

function getPlantData(plant: FusionSolarPlant) {
  return {
    name: plant.plantName,
    vendor: "Huawei",
    stationCode: plant.plantCode,
    plantCode: plant.plantCode,
    capacityKw: toDecimal(plant.capacity),
    latitude: toDecimal(plant.latitude),
    longitude: toDecimal(plant.longitude),
    address: plant.plantAddress,
  };
}

export async function syncFusionSolarPlants(
  organizationId: string,
  connection: FusionSolarConnection,
): Promise<{
  synced: number;
}> {
  const plants = await getAllFusionSolarPlants(connection);

  await prisma.$transaction(
    plants.map((plant) =>
      prisma.plant.upsert({
        where: {
          organizationId_stationCode: {
            organizationId,
            stationCode: plant.plantCode,
          },
        },
        create: {
          organizationId,
          ...getPlantData(plant),
        },
        update: getPlantData(plant),
      }),
    ),
  );

  return {
    synced: plants.length,
  };
}
