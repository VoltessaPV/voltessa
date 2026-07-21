import { prisma } from "@/lib/prisma";

/**
 * The one place Dashboard, Market, Automation, and Reporting read Produced
 * Today / Consumed Today from (Telemetry Architecture Finalization
 * milestone, ADR-010). Reads only `PlantDailyKpi` — the table the
 * synchronization pipeline (`lib/fusionsolar/telemetry-sync-service.ts` ->
 * `import-plant-daily-kpi.ts`) writes Huawei's own daily counters into.
 * Never calls FusionSolar directly; the presentation layer must not either
 * (see CLAUDE.md / this milestone's architecture requirement).
 *
 * Repository-Layer Deduplication milestone: no longer triggers a freshness
 * check itself — that happens exactly once per request now, via
 * `lib/telemetry/plant-context.ts`'s `resolvePlantContext`, called by
 * `getDashboardPageData`/`getProductionPageData` before this function.
 * Synchronization stays invisible to callers either way.
 *
 * Returns `available: false` — never a fabricated `0` — when no row exists
 * yet for `localDate` (e.g. the first ingestion cycle after local midnight
 * hasn't run yet).
 *
 * `totalYieldKwh` (Dashboard UI Refinement milestone) reads Huawei's
 * lifetime `total_power`, already present in every ingested row's
 * `rawPayload` (ADR-010 — no field Huawei returns is ever discarded) but
 * not previously exposed by this function. Not a new Huawei call, not a
 * new stored value, not a new calculation — the same already-fetched
 * response, one more field of it read back out. `null` whenever the field
 * is absent from `rawPayload`, never fabricated.
 */
export type PlantDailyKpiResult =
  | { available: false }
  | {
      available: true;
      producedKwh: number;
      consumedKwh: number;
      totalYieldKwh: number | null;
    };

function readTotalPower(rawPayload: unknown): number | null {
  if (typeof rawPayload !== "object" || rawPayload === null) {
    return null;
  }

  const value = (rawPayload as Record<string, unknown>).total_power;

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function getPlantDailyKpi(
  plantId: string,
  localDate: Date,
): Promise<PlantDailyKpiResult> {
  const row = await prisma.plantDailyKpi.findUnique({
    where: { plantId_localDate: { plantId, localDate } },
    select: { pvYieldKwh: true, consumptionKwh: true, rawPayload: true },
  });

  if (!row) {
    return { available: false };
  }

  return {
    available: true,
    producedKwh: row.pvYieldKwh.toNumber(),
    consumedKwh: row.consumptionKwh.toNumber(),
    totalYieldKwh: readTotalPower(row.rawPayload),
  };
}
