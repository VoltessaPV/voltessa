import { getTranslations } from "next-intl/server";

import { ConnectPlantButton } from "@/components/platform/ConnectPlantButton";
import { EmptyState } from "@/components/platform/EmptyState";
import { NoClientAssignedState } from "@/components/platform/NoClientAssignedState";
import { PageContainer } from "@/components/platform/layout/PageContainer";
import { resolveOrganizationViewAccess } from "@/lib/auth/session";
import { ensureTelemetryFresh } from "@/lib/fusionsolar/telemetry-sync-service";
import { resolvePlantContext } from "@/lib/telemetry/plant-context";
import { revalidateTelemetryPagesIfSynced } from "@/lib/telemetry/revalidate-telemetry-pages";


/**
 * Placeholder page for future battery functionality - no battery
 * integration exists anywhere in this codebase yet (no BESS vendor
 * connection, no Prisma model). A battery cannot exist without a connected
 * plant, so this mirrors automations/page.tsx's gate: no plant -> the same
 * shared "connect a plant" onboarding empty state as every other plant-gated
 * page, never the battery-specific copy. Only once a plant exists does this
 * show the "no battery configured" placeholder.
 */
export default async function BessPage() {
  // Trader Workspace milestone: resolves either the owner's own
  // organization or an assigned trader's selected organization.
  // `readOnly` suppresses the "Connect Plant" CTA below - it starts a
  // real OAuth flow that would modify the organization, never shown to
  // a read-only Trader. `organizationId` is null only for a Trader with
  // zero assigned clients.
  const { organizationId, readOnly } = await resolveOrganizationViewAccess();

  if (organizationId === null) {
    return (
      <PageContainer className="space-y-3">
        <NoClientAssignedState />
      </PageContainer>
    );
  }

  // Transparent Freshness milestone: see settings/page.tsx's identical
  // comment - this page shows no telemetry, so it never blocks.
  await ensureTelemetryFresh(organizationId, {
    mode: "background",
    onSettled: revalidateTelemetryPagesIfSynced,
  });

  const plantContext = await resolvePlantContext(organizationId);
  const t = await getTranslations("battery.page");

  if (!plantContext) {
    return (
      <PageContainer className="space-y-3">
        <EmptyState title={t("emptyStateTitle")} description={t("emptyStateDescription")}>
          {!readOnly && <ConnectPlantButton />}
        </EmptyState>
      </PageContainer>
    );
  }

  return (
    <PageContainer className="space-y-3">
      <EmptyState title={t("noBatteryTitle")} description={t("noBatteryDescription")} />
    </PageContainer>
  );
}
