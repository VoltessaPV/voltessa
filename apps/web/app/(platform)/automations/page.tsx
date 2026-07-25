import { BatteryOptimizationCard } from "@/components/automations/BatteryOptimizationCard";
import { MarketPriceOptimizationCard } from "@/components/automations/MarketPriceOptimizationCard";
import { Permissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export { pageHeading } from "./heading";

export default async function AutomationsPage() {
  const user = await requirePermission(Permissions.canManagePlants);

  const automationSettings = await prisma.automationSettings.findUnique({
    where: { organizationId: user.organizationId },
  });

  return (
    <div>
      <p className="mb-8 text-white/60">
        Configure automated rules for this plant.
      </p>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <MarketPriceOptimizationCard
          initialEnabled={automationSettings?.automationEnabled ?? false}
          initialMinimumExportPrice={
            automationSettings?.minimumExportPrice.toString() ?? "15.00"
          }
        />

        <BatteryOptimizationCard />
      </div>
    </div>
  );
}
