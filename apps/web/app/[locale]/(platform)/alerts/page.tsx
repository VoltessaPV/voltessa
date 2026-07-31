import { getTranslations } from "next-intl/server";

import { NoClientAssignedState } from "@/components/platform/NoClientAssignedState";
import { resolveOrganizationViewAccess } from "@/lib/auth/session";
import { ensureTelemetryFresh } from "@/lib/fusionsolar/telemetry-sync-service";
import { revalidateTelemetryPagesIfSynced } from "@/lib/telemetry/revalidate-telemetry-pages";


export default async function AlertsPage() {
  // Trader Workspace milestone: resolves either the owner's own
  // organization or an assigned trader's selected organization - see that
  // function's own doc comment. This page renders no write controls at
  // all, so `readOnly` needs no further handling here. `organizationId` is
  // null only for a Trader with zero assigned clients.
  const { organizationId } = await resolveOrganizationViewAccess();

  if (organizationId === null) {
    return <NoClientAssignedState />;
  }

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

  const t = await getTranslations("alerts.page");

  return (
    <section>
      <p className="text-white/60">{t("intro")}</p>
    </section>
  );
}
