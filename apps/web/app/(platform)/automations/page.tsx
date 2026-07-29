import { BatteryOptimizationCard } from "@/components/automations/BatteryOptimizationCard";
import { MarketPriceOptimizationCard } from "@/components/automations/MarketPriceOptimizationCard";
import { ConnectFusionSolarButton } from "@/components/platform/ConnectFusionSolarButton";
import { EmptyState } from "@/components/platform/EmptyState";
import { PageContainer } from "@/components/platform/layout/PageContainer";
import { Permissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { ensureTelemetryFresh } from "@/lib/fusionsolar/telemetry-sync-service";
import { prisma } from "@/lib/prisma";
import { resolvePlantContext } from "@/lib/telemetry/plant-context";
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

  // Checked before AutomationSettings is even queried: both cards below
  // configure export/battery behavior for a plant that doesn't exist yet
  // without one, so neither renders at all - a single onboarding card
  // replaces them instead of two cards that would otherwise silently
  // configure nothing.
  const plantContext = await resolvePlantContext(user.organizationId);

  if (!plantContext) {
    return (
      <PageContainer className="space-y-3">
        <EmptyState
          title="No plant connected"
          description="Connect a power plant to see live operational data, energy flow, and inverter status."
        >
          <ConnectFusionSolarButton />
        </EmptyState>
      </PageContainer>
    );
  }

  const automationSettings = await prisma.automationSettings.findUnique({
    where: { organizationId: user.organizationId },
  });

  return (
    <PageContainer className="space-y-3">
      <p className="text-white/60">
        Configure automated rules for this plant.
      </p>

      <div className="space-y-5">
        <MarketPriceOptimizationCard
          initialEnabled={automationSettings?.automationEnabled ?? false}
          initialMinimumExportPrice={
            automationSettings?.minimumExportPrice.toString() ?? "15.00"
          }
        />

        <BatteryOptimizationCard />
      </div>
    </PageContainer>
  );
}
