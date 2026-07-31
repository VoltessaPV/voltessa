import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { Permissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

import { updatePlant } from "../../actions";


const inputClassName =
  "mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition placeholder:text-white/30 focus:border-blue-500";

type EditPlantPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function EditPlantPage({ params }: EditPlantPageProps) {
  const user = await requirePermission(Permissions.canManagePlants);

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

  const updatePlantAction = updatePlant.bind(null, plant.id);
  const [t, tNew] = await Promise.all([
    getTranslations("settings.editPlantPage"),
    getTranslations("settings.newPlantPage"),
  ]);

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <p className="text-white/60">{t("intro")}</p>
      </div>

      <form action={updatePlantAction} className="space-y-8">
        <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-medium">{tNew("generalSection")}</h2>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <label>
              <span className="text-sm text-white/60">{tNew("nameLabel")}</span>
              <input
                name="name"
                required
                defaultValue={plant.name}
                className={inputClassName}
              />
            </label>

            <label>
              <span className="text-sm text-white/60">{tNew("vendorLabel")}</span>
              <input
                name="vendor"
                defaultValue={plant.vendor}
                className={inputClassName}
              />
            </label>

            <label>
              <span className="text-sm text-white/60">{tNew("timezoneLabel")}</span>
              <input
                name="timezone"
                defaultValue={plant.timezone}
                className={inputClassName}
              />
            </label>

            <label>
              <span className="text-sm text-white/60">{tNew("capacityLabel")}</span>
              <input
                name="capacityKw"
                type="number"
                min="0"
                step="0.01"
                defaultValue={plant.capacityKw?.toString() ?? ""}
                className={inputClassName}
              />
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-medium">{tNew("vendorIdentifiersSection")}</h2>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <label>
              <span className="text-sm text-white/60">{tNew("stationCodeLabel")}</span>
              <input
                name="stationCode"
                defaultValue={plant.stationCode ?? ""}
                className={inputClassName}
              />
            </label>

            <label>
              <span className="text-sm text-white/60">{tNew("plantCodeLabel")}</span>
              <input
                name="plantCode"
                defaultValue={plant.plantCode ?? ""}
                className={inputClassName}
              />
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-medium">{tNew("locationSection")}</h2>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <label>
              <span className="text-sm text-white/60">{tNew("countryLabel")}</span>
              <input
                name="country"
                defaultValue={plant.country ?? ""}
                className={inputClassName}
              />
            </label>

            <label>
              <span className="text-sm text-white/60">{tNew("cityLabel")}</span>
              <input
                name="city"
                defaultValue={plant.city ?? ""}
                className={inputClassName}
              />
            </label>

            <label className="md:col-span-2">
              <span className="text-sm text-white/60">{tNew("addressLabel")}</span>
              <input
                name="address"
                defaultValue={plant.address ?? ""}
                className={inputClassName}
              />
            </label>

            <label>
              <span className="text-sm text-white/60">{tNew("latitudeLabel")}</span>
              <input
                name="latitude"
                type="number"
                step="0.000001"
                defaultValue={plant.latitude?.toString() ?? ""}
                className={inputClassName}
              />
            </label>

            <label>
              <span className="text-sm text-white/60">{tNew("longitudeLabel")}</span>
              <input
                name="longitude"
                type="number"
                step="0.000001"
                defaultValue={plant.longitude?.toString() ?? ""}
                className={inputClassName}
              />
            </label>
          </div>
        </section>

        <button
          type="submit"
          className="w-full rounded-xl bg-blue-600 px-5 py-3 font-medium transition hover:bg-blue-500 sm:w-auto"
        >
          {t("saveButton")}
        </button>
      </form>
    </div>
  );
}
