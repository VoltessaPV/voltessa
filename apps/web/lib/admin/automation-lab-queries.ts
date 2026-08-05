import { getStoredExportMode } from "@/lib/automation/automation-state";
import { prisma } from "@/lib/prisma";
import { getPlantTopology, type PlantTopology } from "@/lib/telemetry/plant-topology";

/**
 * Automation Lab's plant picker + info panel — cross-organization by
 * design (Platform Admin only), unlike every customer-facing plant query
 * elsewhere in the app. Modeled on
 * `lib/admin/platform-health.ts`'s `listOrganizationsForCoverageCalendar`,
 * the same cross-org, admin-only pattern already established for the
 * historical-import admin page.
 */
export type AutomationLabPlant = {
  id: string;
  name: string;
  organizationId: string;
  organizationName: string;
  vendor: string;
  capacityKw: number | null;
  topology: PlantTopology;
  automationEnabled: boolean;
  currentExportMode: string | null;
};

export async function listAutomationLabPlants(): Promise<AutomationLabPlant[]> {
  const plants = await prisma.plant.findMany({
    where: { vendor: "Huawei", plantCode: { not: null } },
    orderBy: [{ organization: { name: "asc" } }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      vendor: true,
      capacityKw: true,
      organizationId: true,
      organization: { select: { name: true } },
    },
  });

  return Promise.all(
    plants.map(async (plant) => {
      const [topology, automationSettings, currentExportMode] = await Promise.all([
        getPlantTopology(plant.id),
        prisma.automationSettings.findUnique({
          where: { organizationId: plant.organizationId },
          select: { automationEnabled: true },
        }),
        getStoredExportMode(plant.organizationId),
      ]);

      return {
        id: plant.id,
        name: plant.name,
        organizationId: plant.organizationId,
        organizationName: plant.organization.name,
        vendor: plant.vendor,
        capacityKw: plant.capacityKw ? Number(plant.capacityKw) : null,
        topology,
        automationEnabled: automationSettings?.automationEnabled ?? false,
        currentExportMode,
      };
    }),
  );
}
