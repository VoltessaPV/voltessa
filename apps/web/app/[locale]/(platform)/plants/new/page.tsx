import { getTranslations } from "next-intl/server";

import { createPlant } from "../actions";


const inputClassName =
  "mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition placeholder:text-white/30 focus:border-blue-500";

export default async function NewPlantPage() {
  const t = await getTranslations("settings.newPlantPage");

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <p className="text-white/60">{t("intro")}</p>
      </div>

      <form action={createPlant} className="space-y-8">
        <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-medium">{t("generalSection")}</h2>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <label>
              <span className="text-sm text-white/60">{t("nameLabel")}</span>
              <input
                name="name"
                required
                className={inputClassName}
                placeholder={t("namePlaceholder")}
              />
            </label>

            <label>
              <span className="text-sm text-white/60">{t("vendorLabel")}</span>
              <input
                name="vendor"
                defaultValue="Huawei"
                className={inputClassName}
              />
            </label>

            <label>
              <span className="text-sm text-white/60">{t("timezoneLabel")}</span>
              <input
                name="timezone"
                defaultValue="Europe/Sofia"
                className={inputClassName}
              />
            </label>

            <label>
              <span className="text-sm text-white/60">{t("capacityLabel")}</span>
              <input
                name="capacityKw"
                type="number"
                min="0"
                step="0.01"
                className={inputClassName}
                placeholder={t("capacityPlaceholder")}
              />
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-medium">{t("vendorIdentifiersSection")}</h2>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <label>
              <span className="text-sm text-white/60">{t("stationCodeLabel")}</span>
              <input
                name="stationCode"
                className={inputClassName}
                placeholder={t("stationCodePlaceholder")}
              />
            </label>

            <label>
              <span className="text-sm text-white/60">{t("plantCodeLabel")}</span>
              <input
                name="plantCode"
                className={inputClassName}
                placeholder={t("plantCodePlaceholder")}
              />
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-medium">{t("locationSection")}</h2>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <label>
              <span className="text-sm text-white/60">{t("countryLabel")}</span>
              <input
                name="country"
                className={inputClassName}
                placeholder={t("countryPlaceholder")}
              />
            </label>

            <label>
              <span className="text-sm text-white/60">{t("cityLabel")}</span>
              <input
                name="city"
                className={inputClassName}
                placeholder={t("cityPlaceholder")}
              />
            </label>

            <label className="md:col-span-2">
              <span className="text-sm text-white/60">{t("addressLabel")}</span>
              <input
                name="address"
                className={inputClassName}
                placeholder={t("addressPlaceholder")}
              />
            </label>

            <label>
              <span className="text-sm text-white/60">{t("latitudeLabel")}</span>
              <input
                name="latitude"
                type="number"
                step="0.000001"
                className={inputClassName}
                placeholder="42.697708"
              />
            </label>

            <label>
              <span className="text-sm text-white/60">{t("longitudeLabel")}</span>
              <input
                name="longitude"
                type="number"
                step="0.000001"
                className={inputClassName}
                placeholder="23.321868"
              />
            </label>
          </div>
        </section>

        <button
          type="submit"
          className="w-full rounded-xl bg-blue-600 px-5 py-3 font-medium transition hover:bg-blue-500 sm:w-auto"
        >
          {t("createButton")}
        </button>
      </form>
    </div>
  );
}
