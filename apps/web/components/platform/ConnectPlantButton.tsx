import { getTranslations } from "next-intl/server";
import { Link } from "@/lib/i18n/navigation";

/**
 * The "Connect Plant" CTA shown wherever a page needs to guide a
 * plant-less organization toward connecting one (Dashboard, Market,
 * Automations, Bess empty states - see EmptyState.tsx). Settings' own
 * Power Plants card has its own, separate Connect/Reconnect button that
 * goes straight to the FusionSolar OAuth flow - that card is already
 * explicitly scoped to the FusionSolar integration (title, instructions,
 * and OAuth-callback success/error messaging all specific to it), so it
 * deliberately keeps its existing direct link rather than routing through
 * this generic entry point.
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
