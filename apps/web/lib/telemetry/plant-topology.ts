import { prisma } from "@/lib/prisma";
import { METER_DEV_TYPE_ID } from "@/lib/telemetry/queries";

/**
 * Canonical Entity Contract (ADR-018). The one place Prosumer/Producer
 * topology is derived — from `Device.devTypeId` (meter presence), never
 * from an organization/plant name. Extracted from
 * `lib/fusionsolar/import-plant-daily-kpi.ts` (previously private there) so
 * every consumer, including Automation Lab's plant-info panel, calls this
 * exact same signal instead of re-deriving it.
 */
export async function plantIdsWithMeter(plantIds: string[]): Promise<Set<string>> {
  if (plantIds.length === 0) {
    return new Set();
  }

  const rows = await prisma.device.findMany({
    where: { plantId: { in: plantIds }, devTypeId: METER_DEV_TYPE_ID },
    select: { plantId: true },
  });

  return new Set(rows.map((row) => row.plantId));
}

export type PlantTopology = "Prosumer" | "Producer";

/** Single-plant convenience wrapper — a plant with a real meter is a Prosumer, one without is a Producer. */
export async function getPlantTopology(plantId: string): Promise<PlantTopology> {
  const metered = await plantIdsWithMeter([plantId]);
  return metered.has(plantId) ? "Prosumer" : "Producer";
}
