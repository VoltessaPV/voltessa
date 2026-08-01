import { Prisma } from "@prisma/client";

import type { FusionSolarConnection } from "@/lib/fusionsolar/api-client";
import { getFusionSolarPlantRealTimeData } from "@/lib/fusionsolar/plant-data";
import { getFusionSolarStationDayKpi } from "@/lib/fusionsolar/station-day-kpi";
import { localDayBoundsUtc, localMonthBoundsUtc } from "@/lib/market-price/timezone";
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

/**
 * Historical Data Auto-Import milestone. Backfills `PlantDailyKpi` for an
 * arbitrary past `[start, end)` range of local calendar days — the
 * historical counterpart to `importPlantDailyKpi` above, which only ever
 * writes *today's* row from Huawei's real-time-only `getStationRealKpi`.
 * Never call this for a range that includes today or the future: Huawei's
 * `getKpiStationDay` reports a day's *settled* totals, and today's row must
 * keep coming from the live real-time importer above.
 *
 * Confirmed against a real production response (see
 * `station-day-kpi.ts`'s doc comment): `getKpiStationDay`'s `collectTime`
 * anchors a whole calendar month and returns one entry per day in that
 * month, so this walks month-by-month (via `localMonthBoundsUtc`), not
 * day-by-day like `import-device-telemetry.ts`'s anchor walk — one Huawei
 * call typically covers the entire requested range.
 *
 * Field mapping (identical to `importPlantDailyKpi` above, different
 * Huawei source fields — see `station-day-kpi.ts` for the confirmed
 * mapping): `PVYield` -> `pvYieldKwh`, `use_power` -> `consumptionKwh`,
 * `ongrid_power` -> `exportedEnergyKwh`.
 *
 * Idempotent via the same `(plantId, localDate)` unique upsert
 * `importPlantDailyKpi` already uses — re-running over an overlapping (or
 * identical) range never creates a duplicate row, only overwrites with the
 * same values.
 */
export type PlantDailyKpiRangeImportResult = {
  plantsRequested: number;
  daysUpserted: number;
  errors: Array<{ stationCode: string; reason: string }>;
};

function computeMonthAnchors(start: Date, end: Date): number[] {
  const anchors: number[] = [];
  let cursor = localMonthBoundsUtc(start, BULGARIA_TIMEZONE);

  while (cursor.start.getTime() < end.getTime()) {
    // Any instant safely inside the month works as `collectTime` - noon on
    // the 1st avoids sitting exactly on a month/DST boundary.
    anchors.push(cursor.start.getTime() + 12 * 60 * 60 * 1000);
    cursor = localMonthBoundsUtc(cursor.end, BULGARIA_TIMEZONE);
  }

  return anchors;
}

export async function importPlantDailyKpiRange(
  organizationId: string,
  connection: FusionSolarConnection,
  range: { start: Date; end: Date },
): Promise<PlantDailyKpiRangeImportResult> {
  const plants = await prisma.plant.findMany({
    where: { organizationId, vendor: "Huawei", stationCode: { not: null } },
    select: { id: true, stationCode: true },
  });

  const monthAnchors = computeMonthAnchors(range.start, range.end);

  let daysUpserted = 0;
  const errors: PlantDailyKpiRangeImportResult["errors"] = [];

  for (const plant of plants) {
    if (!plant.stationCode) {
      continue;
    }

    for (const collectTime of monthAnchors) {
      let monthData: Awaited<ReturnType<typeof getFusionSolarStationDayKpi>>;

      try {
        monthData = await getFusionSolarStationDayKpi(connection, {
          stationCode: plant.stationCode,
          collectTime,
        });
      } catch (error) {
        errors.push({
          stationCode: plant.stationCode,
          reason: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      for (const entry of monthData) {
        // Huawei's own `collectTime` per day does not reliably equal this
        // codebase's local-midnight convention (confirmed off by up to 1h
        // against a known-correct row during Phase 0 verification) - always
        // re-derive `localDate` via the same DST-safe helper every other
        // reader/writer of `PlantDailyKpi` uses, treating `collectTime` as
        // merely "an instant within the target day."
        const localDate = localDayBoundsUtc(
          new Date(entry.collectTime),
          BULGARIA_TIMEZONE,
        ).start;

        if (localDate.getTime() < range.start.getTime() || localDate.getTime() >= range.end.getTime()) {
          continue;
        }

        const pvYieldKwh = toDecimal(entry.dataItemMap.PVYield);
        const consumptionKwh = toDecimal(entry.dataItemMap.use_power);

        // Same "never fabricate a placeholder row" rule as
        // `importPlantDailyKpi` above.
        if (pvYieldKwh === null || consumptionKwh === null) {
          errors.push({
            stationCode: plant.stationCode,
            reason: "missing_pv_yield_or_use_power",
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
            exportedEnergyKwh: toDecimal(entry.dataItemMap.ongrid_power),
            rawPayload: entry.dataItemMap as unknown as Prisma.InputJsonValue,
          },
          update: {
            pvYieldKwh,
            consumptionKwh,
            exportedEnergyKwh: toDecimal(entry.dataItemMap.ongrid_power),
            rawPayload: entry.dataItemMap as unknown as Prisma.InputJsonValue,
          },
        });

        daysUpserted += 1;
      }
    }
  }

  return {
    plantsRequested: plants.length,
    daysUpserted,
    errors,
  };
}
