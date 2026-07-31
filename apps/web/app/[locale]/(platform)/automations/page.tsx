import { getTranslations } from "next-intl/server";

import { BatteryOptimizationCard } from "@/components/automations/BatteryOptimizationCard";
import { MarketPriceOptimizationCard } from "@/components/automations/MarketPriceOptimizationCard";
import { MarketPriceOptimizationSummaryCard } from "@/components/automations/MarketPriceOptimizationSummaryCard";
import { ConnectFusionSolarButton } from "@/components/platform/ConnectFusionSolarButton";
import { EmptyState } from "@/components/platform/EmptyState";
import { NoClientAssignedState } from "@/components/platform/NoClientAssignedState";
import { PageContainer } from "@/components/platform/layout/PageContainer";
import { Permissions } from "@/lib/auth/permissions";
import {
  requireCurrentUser,
  requirePermission,
  requireTraderOrganizationAccess,
} from "@/lib/auth/session";
import { ensureTelemetryFresh } from "@/lib/fusionsolar/telemetry-sync-service";
import { prisma } from "@/lib/prisma";
import { resolvePlantContext } from "@/lib/telemetry/plant-context";
import { revalidateTelemetryPagesIfSynced } from "@/lib/telemetry/revalidate-telemetry-pages";


/**
 * Trader Self-Service Onboarding milestone. `readOnly` is true only for
 * the Energy Trader branch below - it swaps `MarketPriceOptimizationCard`
 * (interactive, edits `AutomationSettings`) for
 * `MarketPriceOptimizationSummaryCard` (plain display, no write path at
 * all) and suppresses the "Connect Plant" CTA in the empty state. The
 * owner branch is otherwise byte-for-byte what this page already did -
 * `requirePermission(Permissions.canManagePlants)` is deliberately
 * untouched, not folded into a shared helper, so this milestone can never
 * accidentally weaken that check.
 */
async function renderAutomations(organizationId: string | null, readOnly: boolean) {
  // Trader Workspace milestone: null only for a Trader with zero assigned
  // clients (never an owner - `requireOnboardedUser()` guarantees a real
  // organization). A plain empty state, not a redirect - the rest of the
  // workspace stays reachable.
  if (organizationId === null) {
    return (
      <PageContainer className="space-y-3">
        <NoClientAssignedState />
      </PageContainer>
    );
  }

  // Transparent Freshness milestone: see settings/page.tsx's identical
  // comment - Automations renders no telemetry, so this never blocks.
  await ensureTelemetryFresh(organizationId, {
    mode: "background",
    onSettled: revalidateTelemetryPagesIfSynced,
  });

  // Checked before AutomationSettings is even queried: both cards below
  // configure export/battery behavior for a plant that doesn't exist yet
  // without one, so neither renders at all - a single onboarding card
  // replaces them instead of two cards that would otherwise silently
  // configure nothing.
  const plantContext = await resolvePlantContext(organizationId);
  const t = await getTranslations("automations.page");

  if (!plantContext) {
    return (
      <PageContainer className="space-y-3">
        <EmptyState title={t("emptyStateTitle")} description={t("emptyStateDescription")}>
          {!readOnly && <ConnectFusionSolarButton />}
        </EmptyState>
      </PageContainer>
    );
  }

  const automationSettings = await prisma.automationSettings.findUnique({
    where: { organizationId },
  });

  return (
    <PageContainer className="space-y-3">
      <p className="text-white/60">{readOnly ? t("introReadOnly") : t("intro")}</p>

      <div className="space-y-5">
        {readOnly ? (
          <MarketPriceOptimizationSummaryCard
            enabled={automationSettings?.automationEnabled ?? false}
            minimumExportPrice={automationSettings?.minimumExportPrice.toString() ?? "15.00"}
          />
        ) : (
          <MarketPriceOptimizationCard
            initialEnabled={automationSettings?.automationEnabled ?? false}
            initialMinimumExportPrice={
              automationSettings?.minimumExportPrice.toString() ?? "15.00"
            }
          />
        )}

        <BatteryOptimizationCard />
      </div>
    </PageContainer>
  );
}

export default async function AutomationsPage() {
  const identity = await requireCurrentUser();

  if (identity.accountType === "ENERGY_TRADER") {
    const access = await requireTraderOrganizationAccess();
    return renderAutomations(access.organizationId, true);
  }

  const user = await requirePermission(Permissions.canManagePlants);
  return renderAutomations(user.organizationId, false);
}
