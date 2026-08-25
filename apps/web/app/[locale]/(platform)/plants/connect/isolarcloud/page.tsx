import { getTranslations } from "next-intl/server";
import { Link } from "@/lib/i18n/navigation";

import { Permissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { findSungrowConnection } from "@/lib/isolarcloud/api-client";
import { getAllSungrowPlants } from "@/lib/isolarcloud/plants";
import { prisma } from "@/lib/prisma";

import { connectSungrowPlant } from "./actions";

/**
 * Sungrow iSolarCloud plant picker — reached after
 * `app/api/auth/isolarcloud/callback/route.ts` has stored a
 * `SungrowConnection`. Mirrors `/plants/connect/gateway`'s conventions
 * (`requirePermission`, `STATUS_STYLE`-less plain list, a `backLink`) but
 * is not read-only like that page: picking a station here is the one
 * action that actually creates/associates a `Plant` (see `./actions.ts`),
 * because Sungrow's own brief explicitly requires a picker step Huawei's
 * flow doesn't have.
 */
export default async function ConnectPlantIsolarcloudPage() {
  const user = await requirePermission(Permissions.canManagePlants);

  const t = await getTranslations("settings.connectIsolarcloudPage");

  const connection = await findSungrowConnection(user.organizationId);

  const connectedStationCodes = new Set(
    (
      await prisma.plant.findMany({
        where: { organizationId: user.organizationId, vendor: "Sungrow" },
        select: { stationCode: true },
      })
    )
      .map((plant) => plant.stationCode)
      .filter((stationCode): stationCode is string => stationCode !== null),
  );

  const stations = connection ? await getAllSungrowPlants(connection) : [];
  const availableStations = stations.filter((station) => !connectedStationCodes.has(station.psId));

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <Link href="/plants/connect" className="text-sm text-white/50 hover:text-white/80">
          {t("backLink")}
        </Link>

        <h2 className="mt-3 text-2xl font-semibold text-white">{t("title")}</h2>
        <p className="mt-2 text-white/60">{t("intro")}</p>
      </div>

      {!connection ? (
        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-6">
          <p className="text-sm text-white/70">{t("notConnected")}</p>
        </div>
      ) : availableStations.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <p className="text-sm text-white/60">{t("noStationsAvailable")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {availableStations.map((station) => (
            <form
              key={station.psId}
              action={connectSungrowPlant}
              className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 p-6"
            >
              <input type="hidden" name="psId" value={station.psId} />
              <input type="hidden" name="psName" value={station.psName} />

              <div>
                <h3 className="text-lg font-semibold text-white">{station.psName}</h3>
                {station.psLocation ? (
                  <p className="mt-1 text-sm text-white/60">{station.psLocation}</p>
                ) : null}
              </div>

              <button
                type="submit"
                className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
              >
                {t("connectButton")}
              </button>
            </form>
          ))}
        </div>
      )}
    </div>
  );
}
