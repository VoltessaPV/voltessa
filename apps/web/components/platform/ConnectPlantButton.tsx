import { getTranslations } from "next-intl/server";
import { Link } from "@/lib/i18n/navigation";

/**
 * The "Connect Plant" CTA shown wherever a page needs to guide an
 * organization toward connecting a plant - Dashboard, Market, Automations,
 * Bess empty states (see EmptyState.tsx), and Settings' own Power Plants
 * card (Settings Connect-Plant Consistency milestone: Settings used to
 * have its own separate Connect/Reconnect button going straight to the
 * FusionSolar OAuth flow; it now reuses this exact component instead of
 * a second implementation, so every "Connect Plant" entry point in the
 * app is this one component). Settings still renders its own
 * OAuth-callback success/error messaging (params.fusionsolar/reason) next
 * to this button - that's tied to the FusionSolar callback redirect
 * itself, unrelated to which button started the flow.
 *
 * Connection-Type Selection milestone: this used to link straight into
 * the FusionSolar OAuth flow (/api/auth/fusionsolar/connect). It now
 * links to /plants/connect, the connection-type selector, so "Connect
 * Plant" can offer more than one connection method (Huawei today,
 * Voltessa Gateway and future vendors alongside it) without this button
 * itself needing to know about any of them. A plain internal navigation
 * now, not an OAuth redirect, so this uses next-intl's own Link (which
 * benefits from prefetching) instead of the previous plain <a> - that
 * <a> existed specifically to avoid Link's prefetching starting the OAuth
 * flow early, which no longer applies once this points at an ordinary
 * page.
 */
export async function ConnectPlantButton() {
  const t = await getTranslations("shared");

  return (
    <Link
      href="/plants/connect"
      className="inline-block rounded-xl bg-blue-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
    >
      {t("connectPlantButton")}
    </Link>
  );
}
