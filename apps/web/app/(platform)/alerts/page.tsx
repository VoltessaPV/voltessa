import { requireOnboardedUser } from "@/lib/auth/session";
import { ensureTelemetryFresh } from "@/lib/fusionsolar/telemetry-sync-service";
import { revalidateTelemetryPagesIfSynced } from "@/lib/telemetry/revalidate-telemetry-pages";

export { pageHeading } from "./heading";

export default async function AlertsPage() {
  const user = await requireOnboardedUser();

  // Transparent Freshness milestone: see settings/page.tsx's identical
  // comment - this page shows no telemetry, so it never blocks. (Also the
  // first place this page resolves the current user at all - previously a
  // static component relying entirely on the platform layout's own auth
  // gate; that gate still applies, this just additionally needs
  // organizationId to know which connection to check.)
  await ensureTelemetryFresh(user.organizationId, {
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
