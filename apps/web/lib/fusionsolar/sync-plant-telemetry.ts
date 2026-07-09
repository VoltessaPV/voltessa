import { Prisma } from "@prisma/client";

import type { FusionSolarConnection } from "@/lib/fusionsolar/api-client";
import { getFusionSolarPlantRealTimeData } from "@/lib/fusionsolar/plant-data";
import { prisma } from "@/lib/prisma";

const MAX_STATION_CODES_PER_REQUEST = 100;

function toDecimal(
  value: number | null,
): Prisma.Decimal | null {
  if (value === null) {
    return null;
  }

  return new Prisma.Decimal(value);
}

export async function syncFusionSolarPlantTelemetry(
  organizationId: string,
  connection: FusionSolarConnection,
): Promise<{
  plantsRequested: number;
  snapshotsCreated: number;
}> {
  const plants = await prisma.plant.findMany({
    where: {
      organizationId,
      vendor: "Huawei",
      stationCode: {
        not: null,
      },
      plantCode: {
        not: null,
      },
    },
    select: {
      id: true,
      stationCode: true,
    },
  });

  const plantByStationCode = new Map(
    plants.flatMap((plant) =>
      plant.stationCode
        ? [[plant.stationCode, plant] as const]
        : [],
    ),
  );

  let snapshotsCreated = 0;

  for (
    let offset = 0;
    offset < plants.length;
    offset += MAX_STATION_CODES_PER_REQUEST
  ) {
    const batch = plants.slice(
      offset,
      offset + MAX_STATION_CODES_PER_REQUEST,
    );

    const stationCodes = batch.flatMap((plant) =>
      plant.stationCode ? [plant.stationCode] : [],
    );

    const realtimeData =
      await getFusionSolarPlantRealTimeData(
        connection,
        stationCodes,
      );

    const snapshots = realtimeData.flatMap((item) => {
      const plant = plantByStationCode.get(
        item.stationCode,
      );

      if (!plant) {
        return [];
      }

      const data = item.dataItemMap;

      return [
        {
          plantId: plant.id,
          totalIncome: toDecimal(data.total_income),
          totalPower: toDecimal(data.total_power),
          dayOnGridEnergy: toDecimal(
            data.day_on_grid_energy,
          ),
          dayPower: toDecimal(data.day_power),
          dayUseEnergy: toDecimal(data.day_use_energy),
          dayIncome: toDecimal(data.day_income),
          realHealthState: data.real_health_state,
          monthPower: toDecimal(data.month_power),
        },
      ];
    });

    if (snapshots.length === 0) {
      continue;
    }

    const result =
      await prisma.plantTelemetrySnapshot.createMany({
        data: snapshots,
      });

    snapshotsCreated += result.count;
  }

  return {
    plantsRequested: plants.length,
    snapshotsCreated,
  };
}
