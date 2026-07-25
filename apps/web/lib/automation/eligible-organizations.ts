import { prisma } from "@/lib/prisma";

const ATLANTA_PLANT_NAME = "Atlanta";

export type EligibleOrganization = {
  organizationId: string;
  minimumExportPrice: number;
};

/**
 * Organizations in scope for the Market Price Optimization Execution
 * Engine: automation must be enabled (AutomationSettings.automationEnabled)
 * AND the organization must own a Plant named "Atlanta" — the Automation
 * Service itself is hardcoded to Atlanta only (see automation/src/
 * fusionSolar/atlanta-service.ts), so there is nothing to execute for any
 * other organization regardless of its automation settings. Reuses the
 * exact same "does this org own Atlanta" check as
 * app/dev/fusionsolar_atlanta/page.tsx, rather than inventing a second one.
 */
export async function findEligibleOrganizations(): Promise<
  EligibleOrganization[]
> {
  const settings = await prisma.automationSettings.findMany({
    where: { automationEnabled: true },
    select: { organizationId: true, minimumExportPrice: true },
  });

  if (settings.length === 0) {
    return [];
  }

  const plants = await prisma.plant.findMany({
    where: {
      organizationId: { in: settings.map((setting) => setting.organizationId) },
      name: ATLANTA_PLANT_NAME,
    },
    select: { organizationId: true },
  });

  const organizationIdsWithAtlanta = new Set(
    plants.map((plant) => plant.organizationId),
  );

  return settings
    .filter((setting) => organizationIdsWithAtlanta.has(setting.organizationId))
    .map((setting) => ({
      organizationId: setting.organizationId,
      minimumExportPrice: Number(setting.minimumExportPrice.toString()),
    }));
}
