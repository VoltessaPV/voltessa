import { prisma } from "@/lib/prisma";
import { currentDayOfWeekInZone } from "./day-of-week";

const ATLANTA_PLANT_NAME = "Atlanta";

export type EligibleOrganization = {
  organizationId: string;
  minimumExportPrice: number;
};

/**
 * Organizations in scope for the Market Price Optimization Execution
 * Engine: automation must be enabled (AutomationSettings.automationEnabled)
 * AND today (in the automation engine's own Europe/Sofia timezone - see
 * day-of-week.ts) must be one of the organization's configured
 * `enabledDays` AND the organization must own a Plant named "Atlanta" — the
 * Automation Service itself is hardcoded to Atlanta only (see automation/
 * src/fusionSolar/atlanta-service.ts), so there is nothing to execute for
 * any other organization regardless of its automation settings. Reuses the
 * exact same "does this org own Atlanta" check as
 * app/dev/fusionsolar_atlanta/page.tsx, rather than inventing a second one.
 *
 * The day-of-week filter lives here, at query time, alongside
 * `automationEnabled` — the same eligibility layer, not a second check
 * bolted on elsewhere — so an organization whose today isn't enabled (or
 * whose `enabledDays` is empty) is simply absent from this function's
 * result for the whole day, exactly like `automationEnabled: false` already
 * makes it absent. `decideExportAction` (the hysteresis/price logic) never
 * sees, and never needs to know about, day-of-week at all.
 */
export async function findEligibleOrganizations(): Promise<
  EligibleOrganization[]
> {
  const today = currentDayOfWeekInZone(new Date());

  const settings = await prisma.automationSettings.findMany({
    where: { automationEnabled: true, enabledDays: { has: today } },
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

/**
 * Organizations in scope for daily reconciliation: owning a Plant named
 * "Atlanta" is the only requirement — deliberately independent of
 * AutomationSettings.automationEnabled, unlike findEligibleOrganizations
 * above. Reconciliation is read-only (it only ever calls the Automation
 * Service's Read Status operation, never zero-export/no-limit) and only
 * updates Voltessa's own stored AutomationState, never FusionSolar itself -
 * so it stays safe, and useful, to run regardless of whether automation is
 * currently enabled. This is what keeps AutomationState accurate the
 * moment automation is turned back on, instead of acting on stale state
 * from whenever it was last enabled.
 */
export async function findAtlantaOrganizationIds(): Promise<string[]> {
  const plants = await prisma.plant.findMany({
    where: { name: ATLANTA_PLANT_NAME },
    select: { organizationId: true },
  });

  return [...new Set(plants.map((plant) => plant.organizationId))];
}
