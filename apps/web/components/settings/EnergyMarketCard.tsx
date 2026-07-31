"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { updateEnergyMarket, type ActionResult } from "@/app/[locale]/(platform)/settings/actions";
import { getBulgarianDistributionOperators } from "@/lib/market/distribution/bg";
import { getBulgarianElectricitySuppliers } from "@/lib/market/suppliers/bg";

import { ActionToast } from "./ActionToast";
import { SettingsCard } from "./SettingsCard";
import { SubmitButton } from "./SubmitButton";

type EnergyMarketCardProps = {
  country: string;
  supplierId: string | null;
  dsoId: string | null;
};

// [color-scheme:dark] + optionStyle: same fix as
// app/dev/huawei-api/HuaweiDiagnosticTestsCard.tsx's selectClassName -
// native <option> popups don't inherit background-color from the
// <select>, so without this they render on the browser's default opaque
// white surface under our white option text.
const selectClassName =
  "h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white outline-none transition focus:border-white/20 [color-scheme:dark]";
const optionStyle = { backgroundColor: "#0f172a", color: "#f8fafc" };

/**
 * The supplier list lives in `lib/market/suppliers/bg.ts` and the DSO list
 * in `lib/market/distribution/bg.ts` (data only, no UI) — this component
 * only renders whatever `getBulgarianElectricitySuppliers()`/
 * `getBulgarianDistributionOperators()` return, including their own
 * ordering, so adding/renaming/localizing an entry there never requires a
 * change here. Both dropdowns display each entry's `officialBulgarianName`;
 * only the `id` is ever stored.
 */
export function EnergyMarketCard({ country, supplierId, dsoId }: EnergyMarketCardProps) {
  const t = useTranslations("settings.energyMarket");
  const tActions = useTranslations("shared.actions");
  const tMarketInfo = useTranslations("market.info");
  const [result, formAction, isPending] = useActionState<ActionResult, FormData>(
    updateEnergyMarket,
    null,
  );

  const suppliers = getBulgarianElectricitySuppliers();
  const regularSuppliers = suppliers.filter((supplier) => !supplier.special);
  const specialSuppliers = suppliers.filter((supplier) => supplier.special);

  const operators = getBulgarianDistributionOperators();

  return (
    <SettingsCard title={t("title")} description={t("description")}>
      <form action={formAction} className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-500">
            {t("countryLabel")}
          </span>
          <select name="country" defaultValue={country} className={selectClassName}>
            <option value="Bulgaria" style={optionStyle}>{tMarketInfo("countryName")}</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-500">
            {t("supplierLabel")}
          </span>
          <select
            name="supplierId"
            defaultValue={supplierId ?? ""}
            className={selectClassName}
          >
            <option value="" style={optionStyle}>{t("notSelected")}</option>

            {regularSuppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id} style={optionStyle}>
                {supplier.officialBulgarianName}
              </option>
            ))}

            {specialSuppliers.length > 0 && (
              <option disabled style={optionStyle}>──────────</option>
            )}

            {specialSuppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id} style={optionStyle}>
                {supplier.officialBulgarianName}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-500">
            {t("dsoLabel")}
          </span>
          <select
            name="dsoId"
            defaultValue={dsoId ?? ""}
            className={selectClassName}
          >
            <option value="" style={optionStyle}>{t("notSelected")}</option>

            {operators.map((operator) => (
              <option key={operator.id} value={operator.id} style={optionStyle}>
                {operator.officialBulgarianName}
              </option>
            ))}
          </select>
        </label>

        <div className="flex justify-end pt-1">
          <SubmitButton isPending={isPending} label={tActions("save")} />
        </div>
      </form>

      <ActionToast result={result} />
    </SettingsCard>
  );
}
