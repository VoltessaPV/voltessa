import { BatteryOptimizationCard } from "@/components/automations/BatteryOptimizationCard";
import { MarketPriceOptimizationCard } from "@/components/automations/MarketPriceOptimizationCard";
import { Permissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { ensureTelemetryFresh } from "@/lib/fusionsolar/telemetry-sync-service";
import { prisma } from "@/lib/prisma";
import { revalidateTelemetryPagesIfSynced } from "@/lib/telemetry/revalidate-telemetry-pages";

export { pageHeading } from "./heading";

export default async function AutomationsPage() {
  const user = await requirePermission(Permissions.canManagePlants);

  // Transparent Freshness milestone: see settings/page.tsx's identical
  // comment - Automations renders no telemetry, so this never blocks.
  await ensureTelemetryFresh(user.organizationId, {
    mode: "background",
    onSettled: revalidateTelemetryPagesIfSynced,
  });

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
