import { Prisma } from "@prisma/client";

import type { FusionSolarConnection } from "@/lib/fusionsolar/api-client";
import {
  getAllFusionSolarPlants,
  type FusionSolarPlant,
} from "@/lib/fusionsolar/plants";
import { prisma } from "@/lib/prisma";

/**
 * Onboarding creates a placeholder `Plant` row from the owner's own
 * self-reported name/capacity (`app/[locale]/(platform)/plants/actions.ts`'s
 * `createPlant`) before FusionSolar is ever connected — a new owner has no
 * way to know Huawei's internal `stationCode`. That row therefore has
 * `stationCode: null`. Upserting purely on `(organizationId, stationCode)`
 * would never match it (its `stationCode` isn't the real one yet) and would
 * create a second, duplicate `Plant` instead. Matches the MVP's single-plant
 * scope already assumed elsewhere in this codebase (see
 * `production-data.ts`'s own documented assumption): only applied when the
 * organization has exactly one such unlinked placeholder and Huawei returns
 * exactly one station, so a multi-plant organization is never guessed at —
 * it falls through to the plain per-station upsert below unchanged.
 */
async function findUnlinkedPlaceholderPlantId(
  organizationId: string,
  stations: FusionSolarPlant[],
): Promise<{ placeholderPlantId: string; station: FusionSolarPlant } | null> {
  const [station, ...rest] = stations;

  if (!station || rest.length > 0) {
    return null;
  }

  const unlinkedPlants = await prisma.plant.findMany({
    where: { organizationId, vendor: "Huawei", stationCode: null },
    select: { id: true },
  });

  const [placeholder, ...otherPlaceholders] = unlinkedPlants;

  return placeholder && otherPlaceholders.length === 0
    ? { placeholderPlantId: placeholder.id, station }
    : null;
}

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

  const placeholder = await findUnlinkedPlaceholderPlantId(organizationId, plants);

  if (placeholder) {
    await prisma.plant.update({
      where: { id: placeholder.placeholderPlantId },
      data: getPlantData(placeholder.station),
    });
  } else {
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
  }

  return {
    synced: plants.length,
  };
}
