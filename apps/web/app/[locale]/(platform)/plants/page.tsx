import { getTranslations } from "next-intl/server";
import { Link } from "@/lib/i18n/navigation";

import { Permissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { ensureTelemetryFresh } from "@/lib/fusionsolar/telemetry-sync-service";
import { prisma } from "@/lib/prisma";
import { revalidateTelemetryPagesIfSynced } from "@/lib/telemetry/revalidate-telemetry-pages";


export default async function PlantsPage() {
  const user = await requirePermission(Permissions.canViewPlants);

  // Transparent Freshness milestone: see settings/page.tsx's identical
  // comment - this page lists plant configuration, not live telemetry, so
  // it never blocks.
  await ensureTelemetryFresh(user.organizationId, {
    mode: "background",
    onSettled: revalidateTelemetryPagesIfSynced,
  });

  const plants = await prisma.plant.findMany({
    where: {
      organizationId: user.organizationId,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const t = await getTranslations("settings.plantsPage");

  return (
    <div>
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-white/60">{t("intro")}</p>

        <Link
          href="/plants/new"
          className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-center font-medium hover:bg-blue-500"
        >
          {t("addPlantButton")}
        </Link>
      </div>

      {plants.length === 0 ? (
        <p>{t("noPlantsYet")}</p>
      ) : (
        <ul>
          {plants.map((plant) => (
            <li key={plant.id}>
              <Link
                href={`/plants/${plant.id}`}
                className="font-medium text-blue-400 hover:text-blue-300"
              >
                {plant.name}
              </Link>

              <span>
                {" "}
                — {plant.vendor} — {plant.timezone}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
