import { getTranslations } from "next-intl/server";
import { Link } from "@/lib/i18n/navigation";

import { Permissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";

/**
 * Connection-Type Selection milestone. The entry point every "Connect
 * Plant" CTA now leads to (see ConnectPlantButton) instead of jumping
 * straight into the Huawei/FusionSolar OAuth flow. Deliberately just a
 * static list of connection types, not a database-backed provider
 * registry or a plugin framework - the existing architecture doesn't
 * need one yet (only two connection types exist), and CLAUDE.md's
 * "simplicity beats cleverness" applies here. Adding a future connection
 * type (Sungrow, Geya, ...) is one new entry in CONNECTION_TYPES plus its
 * own destination page - no change to this page's structure. Sungrow
 * iSolarCloud (Sungrow OAuth2 provider milestone) is the first of these:
 * one more entry, one new OAuth-init route
 * (/api/auth/isolarcloud/connect), same as Huawei's own entry.
 *
 * `external: true` marks a destination that isn't a page in this app (the
 * Huawei and Sungrow options go straight to their own OAuth-init route,
 * which redirects onward) - those use a plain <a> the same way the old
 * ConnectFusionSolarButton did, so Link's prefetching can never start an
 * OAuth flow early. Internal destinations (Voltessa Gateway) use Link.
 */
type ConnectionType = {
  id: "huawei" | "sungrow" | "gateway";
  href: string;
  external?: boolean;
};

const CONNECTION_TYPES: ConnectionType[] = [
  { id: "huawei", href: "/api/auth/fusionsolar/connect", external: true },
  { id: "sungrow", href: "/api/auth/isolarcloud/connect", external: true },
  { id: "gateway", href: "/plants/connect/gateway" },
];

export default async function ConnectPlantPage() {
  await requirePermission(Permissions.canManagePlants);

  const t = await getTranslations("settings.connectPlantPage");

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-white">{t("title")}</h2>
        <p className="mt-2 text-white/60">{t("intro")}</p>
      </div>

      <div className="space-y-4">
        {CONNECTION_TYPES.map((connectionType) => (
          <div
            key={connectionType.id}
            className="rounded-2xl border border-white/10 bg-white/5 p-6"
          >
            <h3 className="text-lg font-semibold text-white">
              {t(`${connectionType.id}.title`)}
            </h3>
            <p className="mt-1 text-sm text-white/70">
              {t(`${connectionType.id}.description`)}
            </p>

            {connectionType.external ? (
              <a
                href={connectionType.href}
                className="mt-5 block w-full rounded-xl bg-blue-600 px-4 py-3 text-center font-semibold text-white transition hover:bg-blue-500 sm:inline-block sm:w-auto"
              >
                {t(`${connectionType.id}.button`)}
              </a>
            ) : (
              <Link
                href={connectionType.href}
                className="mt-5 block w-full rounded-xl bg-blue-600 px-4 py-3 text-center font-semibold text-white transition hover:bg-blue-500 sm:inline-block sm:w-auto"
              >
                {t(`${connectionType.id}.button`)}
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
