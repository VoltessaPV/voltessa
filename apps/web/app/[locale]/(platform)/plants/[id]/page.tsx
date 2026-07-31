import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/lib/i18n/navigation";

import { Permissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";


type Props = {
  params: Promise<{
    id: string;
  }>;
};

export default async function PlantDetailsPage({ params }: Props) {
  const user = await requirePermission(Permissions.canViewPlants);

  const { id } = await params;

  const plant = await prisma.plant.findFirst({
    where: {
      id,
      organizationId: user.organizationId,
    },
  });

  if (!plant) {
    notFound();
  }

  const t = await getTranslations("settings.plantDetailsPage");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="min-w-0 truncate text-2xl font-semibold text-white">{plant.name}</h2>

        <Link
          href={`/plants/${plant.id}/edit`}
          className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 hover:bg-blue-500"
        >
          {t("editLink")}
        </Link>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <dl className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-sm text-white/50">{t("vendorLabel")}</dt>

            <dd className="mt-1">{plant.vendor}</dd>
          </div>

          <div>
            <dt className="text-sm text-white/50">{t("timezoneLabel")}</dt>

            <dd className="mt-1">{plant.timezone}</dd>
          </div>

          <div>
            <dt className="text-sm text-white/50">{t("createdLabel")}</dt>

            <dd className="mt-1">{plant.createdAt.toLocaleString()}</dd>
          </div>

          <div>
            <dt className="text-sm text-white/50">{t("stationCodeLabel")}</dt>

            <dd className="mt-1">{plant.stationCode ?? "-"}</dd>
          </div>

          <div>
            <dt className="text-sm text-white/50">{t("capacityLabel")}</dt>

            <dd className="mt-1">
              {plant.capacityKw ? `${plant.capacityKw} kW` : "-"}
            </dd>
          </div>

          <div>
            <dt className="text-sm text-white/50">{t("countryLabel")}</dt>

            <dd className="mt-1">{plant.country ?? "-"}</dd>
          </div>

          <div>
            <dt className="text-sm text-white/50">{t("cityLabel")}</dt>

            <dd className="mt-1">{plant.city ?? "-"}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
