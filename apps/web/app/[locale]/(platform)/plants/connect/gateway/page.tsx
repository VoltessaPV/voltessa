import { getTranslations } from "next-intl/server";
import { Link } from "@/lib/i18n/navigation";

import { Permissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

/**
 * Connection-Type Selection milestone. Entry point only for the Voltessa
 * Gateway connection type - the actual gateway-based device integration
 * (KACO / blue'Log / inverter reads) is a future milestone, not this one.
 * This page exists to establish the route and reuse the organization's
 * real, existing `Gateway` rows (no new model, no provisioning UI - see
 * docs/infrastructure/gateway-provisioning.md, unchanged by this
 * milestone) rather than showing an empty placeholder.
 *
 * Deliberately read-only: lists this organization's gateways (a gateway
 * can exist, even be ACTIVE, with no plant yet - "awaiting a new plant
 * onboarding" per the Gateway Provisioning milestone) without ever
 * creating a Plant or writing Gateway.plantId itself. Associating a
 * gateway with a plant is exactly the next milestone's job.
 */
const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-emerald-400/10 text-emerald-400",
  ENROLLED: "bg-sky-400/10 text-sky-400",
  PROVISIONED: "bg-amber-400/10 text-amber-400",
  REVOKED: "bg-red-400/10 text-red-400",
};

export default async function ConnectPlantGatewayPage() {
  const user = await requirePermission(Permissions.canManagePlants);

  const t = await getTranslations("settings.connectGatewayPage");

  const gateways = await prisma.gateway.findMany({
    where: { organizationId: user.organizationId },
    orderBy: { createdAt: "asc" },
    include: { plant: { select: { name: true } } },
  });

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <Link href="/plants/connect" className="text-sm text-white/50 hover:text-white/80">
          {t("backLink")}
        </Link>

        <h2 className="mt-3 text-2xl font-semibold text-white">{t("title")}</h2>
        <p className="mt-2 text-white/60">{t("intro")}</p>
      </div>

      <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-6">
        <h3 className="text-sm font-medium text-amber-300">{t("comingSoonTitle")}</h3>
        <p className="mt-1 text-sm text-white/60">{t("comingSoonDescription")}</p>
      </div>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <h3 className="text-sm font-medium uppercase tracking-wider text-white/50">
          {t("gatewaysListTitle")}
        </h3>

        {gateways.length === 0 ? (
          <p className="mt-4 text-sm text-white/50">{t("noGatewaysYet")}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-white/40">
                  <th className="pb-2 pr-4">{t("hostnameLabel")}</th>
                  <th className="pb-2 pr-4">{t("statusLabel")}</th>
                  <th className="pb-2 pr-4">{t("plantLabel")}</th>
                </tr>
              </thead>
              <tbody>
                {gateways.map((gateway) => (
                  <tr key={gateway.id} className="border-t border-white/10">
                    <td className="py-2 pr-4 text-sm text-white/80">{gateway.hostname}</td>
                    <td className="py-2 pr-4 text-sm">
                      <span
                        className={`rounded-full px-2 py-0.5 ${STATUS_STYLE[gateway.status] ?? "bg-white/10 text-white/60"}`}
                      >
                        {gateway.status}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-sm text-white/70">
                      {gateway.plant?.name ?? t("unassigned")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
