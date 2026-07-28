import { ConnectFusionSolarButton } from "@/components/platform/ConnectFusionSolarButton";
import { EmptyState } from "@/components/platform/EmptyState";
import { PageContainer } from "@/components/platform/layout/PageContainer";
import { requireOnboardedUser } from "@/lib/auth/session";
import { ensureTelemetryFresh } from "@/lib/fusionsolar/telemetry-sync-service";
import { resolvePlantContext } from "@/lib/telemetry/plant-context";
import { revalidateTelemetryPagesIfSynced } from "@/lib/telemetry/revalidate-telemetry-pages";

export { pageHeading } from "./heading";

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
  const user = await requireOnboardedUser();

  // Transparent Freshness milestone: see settings/page.tsx's identical
  // comment - this page shows no telemetry, so it never blocks.
  await ensureTelemetryFresh(user.organizationId, {
    mode: "background",
    onSettled: revalidateTelemetryPagesIfSynced,
  });

  const plantContext = await resolvePlantContext(user.organizationId);

  if (!plantContext) {
    return (
      <PageContainer className="space-y-3">
        <EmptyState
          title="No plant connected"
          description="Battery energy storage features become available after connecting a plant."
        >
          <ConnectFusionSolarButton />
        </EmptyState>
      </PageContainer>
    );
  }

  return (
    <PageContainer className="space-y-3">
      <EmptyState
        title="Battery Energy Storage System"
        description="No battery storage system configured. Battery optimization and energy storage features become available after connecting a supported battery. This page is intentionally a placeholder for future development."
      />
    </PageContainer>
  );
}
