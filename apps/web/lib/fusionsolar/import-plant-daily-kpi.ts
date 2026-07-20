import { Prisma } from "@prisma/client";

import type { FusionSolarConnection } from "@/lib/fusionsolar/api-client";
import { getFusionSolarPlantRealTimeData } from "@/lib/fusionsolar/plant-data";
import { localDayBoundsUtc } from "@/lib/market-price/timezone";
import { prisma } from "@/lib/prisma";

/**
 * Writes `PlantDailyKpi` from Huawei's station-level `getStationRealKpi`
 * (Telemetry Architecture Finalization milestone, ADR-010) — the one place
 * this codebase calls that endpoint. Called every cycle by the same
 * Scaleway-scheduled pipeline that writes `DeviceTelemetry`
 * (`bootstrap-device-telemetry.ts`), never by Dashboard/Market directly.
 *
 * Hardcodes "Europe/Sofia" rather than reading `Plant.timezone`, matching
 * `dashboard-data.ts`'s own documented convention: every reader of this
 * table must derive `localDate` with the exact same timezone, or the
 * `(plantId, localDate)` unique key used to upsert here wouldn't match the
 * key `lib/telemetry/plant-daily-kpi.ts` reads with.
 */
const BULGARIA_TIMEZONE = "Europe/Sofia";

const MAX_STATION_CODES_PER_REQUEST = 10;

function toDecimal(value: number | null): Prisma.Decimal | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  return new Prisma.Decimal(value);
}

export type PlantDailyKpiImportResult = {
  plantsRequested: number;
  kpisUpserted: number;
  errors: Array<{ stationCode: string; reason: string }>;
};

export async function importPlantDailyKpi(
  organizationId: string,
  connection: FusionSolarConnection,
): Promise<PlantDailyKpiImportResult> {
  const plants = await prisma.plant.findMany({
    where: { organizationId, vendor: "Huawei", stationCode: { not: null } },
    select: { id: true, stationCode: true },
  });

  const plantByStationCode = new Map(
    plants.flatMap((plant) => (plant.stationCode ? [[plant.stationCode, plant] as const] : [])),
  );

  const localDate = localDayBoundsUtc(new Date(), BULGARIA_TIMEZONE).start;

  let kpisUpserted = 0;
  const errors: PlantDailyKpiImportResult["errors"] = [];

  for (
    let offset = 0;
    offset < plants.length;
    offset += MAX_STATION_CODES_PER_REQUEST
  ) {
    const batch = plants.slice(offset, offset + MAX_STATION_CODES_PER_REQUEST);
    const stationCodes = batch.flatMap((plant) => (plant.stationCode ? [plant.stationCode] : []));

    let realtimeData: Awaited<ReturnType<typeof getFusionSolarPlantRealTimeData>>;

    try {
      realtimeData = await getFusionSolarPlantRealTimeData(connection, stationCodes);
    } catch (error) {
      for (const stationCode of stationCodes) {
        errors.push({
          stationCode,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      continue;
    }

    for (const item of realtimeData) {
      const plant = plantByStationCode.get(item.stationCode);

      if (!plant) {
        continue;
      }

      const data = item.dataItemMap;
      const pvYieldKwh = toDecimal(data.day_power);
      const consumptionKwh = toDecimal(data.day_use_energy);

      // Never write a placeholder row when Huawei's own daily counters
      // aren't present — an absent row (read back as `available: false`)
      // is honest; a fabricated `0` is not.
      if (pvYieldKwh === null || consumptionKwh === null) {
        errors.push({
          stationCode: item.stationCode,
          reason: "missing_day_power_or_day_use_energy",
        });
        continue;
      }

      await prisma.plantDailyKpi.upsert({
        where: { plantId_localDate: { plantId: plant.id, localDate } },
        create: {
          organizationId,
          plantId: plant.id,
          localDate,
          pvYieldKwh,
          consumptionKwh,
          exportedEnergyKwh: toDecimal(data.day_on_grid_energy),
          rawPayload: data as unknown as Prisma.InputJsonValue,
        },
        update: {
          pvYieldKwh,
          consumptionKwh,
          exportedEnergyKwh: toDecimal(data.day_on_grid_energy),
          rawPayload: data as unknown as Prisma.InputJsonValue,
        },
      });

      kpisUpserted += 1;
    }
  }

  return {
    plantsRequested: plants.length,
    kpisUpserted,
    errors,
  };
}
