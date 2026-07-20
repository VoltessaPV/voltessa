import { prisma } from "@/lib/prisma";

/**
 * The one place Dashboard, Market, Automation, and Reporting read Produced
 * Today / Consumed Today from (Telemetry Architecture Finalization
 * milestone, ADR-010). Reads only `PlantDailyKpi` — the table the Scaleway
 * ingestion pipeline (`bootstrap-device-telemetry.ts` ->
 * `import-plant-daily-kpi.ts`) writes Huawei's own daily counters into every
 * cycle. Never calls FusionSolar directly; the presentation layer must not
 * either (see CLAUDE.md / this milestone's architecture requirement).
 *
 * Returns `available: false` — never a fabricated `0` — when no row exists
 * yet for `localDate` (e.g. the first ingestion cycle after local midnight
 * hasn't run yet).
 */
export type PlantDailyKpiResult =
  | { available: false }
  | { available: true; producedKwh: number; consumedKwh: number };

export async function getPlantDailyKpi(
  plantId: string,
  localDate: Date,
): Promise<PlantDailyKpiResult> {
  const row = await prisma.plantDailyKpi.findUnique({
    where: { plantId_localDate: { plantId, localDate } },
    select: { pvYieldKwh: true, consumptionKwh: true },
  });

  if (!row) {
    return { available: false };
  }

  return {
    available: true,
    producedKwh: row.pvYieldKwh.toNumber(),
    consumedKwh: row.consumptionKwh.toNumber(),
  };
}
