import { prisma } from "@/lib/prisma";

/**
 * Admin Reporting page — plant picker + per-request plant resolution.
 * Cross-organization by design (Platform Admin only), the same pattern
 * `lib/admin/automation-lab-queries.ts` established for Automation Lab and
 * Digital Twin. Every consumer of these functions sits behind
 * `requirePlatformAdmin()` (`lib/auth/session.ts`).
 *
 * A dedicated query rather than reusing `listAutomationLabPlants`: the
 * report needs each plant's canonical `Plant.timezone`, which that type
 * does not carry, and it must not couple to Automation Lab's Huawei-control
 * assumptions.
 */

export type ReportingPlant = {
  id: string;
  name: string;
  organizationId: string;
  organizationName: string;
  vendor: string;
  timezone: string;
  capacityKw: number | null;
};

/**
 * Every plant with real telemetry potential, across all organizations —
 * same filter Automation Lab / Digital Twin use (Huawei, discovered via a
 * `plantCode`). Ordered organization → plant so the picker is stable.
 */
export async function listReportingPlants(): Promise<ReportingPlant[]> {
  const plants = await prisma.plant.findMany({
    where: { vendor: "Huawei", plantCode: { not: null } },
    orderBy: [{ organization: { name: "asc" } }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      timezone: true,
      capacityKw: true,
      organizationId: true,
      organization: { select: { name: true } },
    },
  });

  return plants.map((plant) => ({
    id: plant.id,
    name: plant.name,
    organizationId: plant.organizationId,
    organizationName: plant.organization.name,
    vendor: "Huawei",
    timezone: plant.timezone,
    capacityKw: plant.capacityKw ? Number(plant.capacityKw) : null,
  }));
}

/**
 * Resolves a single plant by id for report generation. Returns `null` when
 * the id does not exist (or is not a reportable plant) — the caller turns
 * that into the same not-found response Automation Lab / the Atlanta
 * console use, never a hint that the id was almost valid. The plant's
 * `organizationId` and `timezone` come from this row, never from the
 * client.
 */
export async function getReportingPlant(plantId: string): Promise<ReportingPlant | null> {
  if (typeof plantId !== "string" || plantId.trim() === "") {
    return null;
  }

  const plant = await prisma.plant.findFirst({
    where: { id: plantId, vendor: "Huawei", plantCode: { not: null } },
    select: {
      id: true,
      name: true,
      timezone: true,
      capacityKw: true,
      organizationId: true,
      organization: { select: { name: true } },
    },
  });

  if (!plant) {
    return null;
  }

  return {
    id: plant.id,
    name: plant.name,
    organizationId: plant.organizationId,
    organizationName: plant.organization.name,
    vendor: "Huawei",
    timezone: plant.timezone,
    capacityKw: plant.capacityKw ? Number(plant.capacityKw) : null,
  };
}
