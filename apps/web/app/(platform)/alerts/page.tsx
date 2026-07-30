import { resolveOrganizationViewAccess } from "@/lib/auth/session";
import { ensureTelemetryFresh } from "@/lib/fusionsolar/telemetry-sync-service";
import { revalidateTelemetryPagesIfSynced } from "@/lib/telemetry/revalidate-telemetry-pages";

export { pageHeading } from "./heading";

export default async function AlertsPage() {
  // Trader Self-Service Onboarding milestone: resolves either the owner's
  // own organization or an assigned trader's selected organization - see
  // that function's own doc comment. This page renders no write controls
  // at all, so `readOnly` needs no further handling here.
  const { organizationId } = await resolveOrganizationViewAccess();

  // Transparent Freshness milestone: see settings/page.tsx's identical
  // comment - this page shows no telemetry, so it never blocks. (Also the
  // first place this page resolves the current user at all - previously a
  // static component relying entirely on the platform layout's own auth
  // gate; that gate still applies, this just additionally needs
  // organizationId to know which connection to check.)
  await ensureTelemetryFresh(organizationId, {
    mode: "background",
    onSettled: revalidateTelemetryPagesIfSynced,
  });

  return (
    <section>
      <p className="text-white/60">
        Review operational alerts and important platform events.
      </p>
    </section>
  );
}
