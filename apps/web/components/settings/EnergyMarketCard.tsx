"use client";

import { useActionState } from "react";

import { updateEnergyMarket, type ActionResult } from "@/app/(platform)/settings/actions";
import { getBulgarianElectricitySuppliers } from "@/lib/market/suppliers/bg";

import { ActionToast } from "./ActionToast";
import { SettingsCard } from "./SettingsCard";
import { SubmitButton } from "./SubmitButton";

type EnergyMarketCardProps = {
  country: string;
  supplierId: string | null;
};

const selectClassName =
  "h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white outline-none transition focus:border-white/20";

/**
 * The supplier list itself lives in `lib/market/suppliers/bg.ts` (data
 * only, no UI) — this component only renders whatever
 * `getBulgarianElectricitySuppliers()` returns, including its own
 * alphabetical-then-special ordering, so a supplier being added/renamed/
 * localized there never requires a change here.
 */
export function EnergyMarketCard({ country, supplierId }: EnergyMarketCardProps) {
  const [result, formAction, isPending] = useActionState<ActionResult, FormData>(
    updateEnergyMarket,
    null,
  );

  const suppliers = getBulgarianElectricitySuppliers();
  const regularSuppliers = suppliers.filter((supplier) => !supplier.special);
  const specialSuppliers = suppliers.filter((supplier) => supplier.special);

  return (
    <SettingsCard
      title="Energy Market"
      description="Country and electricity supplier for this organization."
    >
      <form action={formAction} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-500">
              Country
            </span>
            <select name="country" defaultValue={country} className={selectClassName}>
              <option value="Bulgaria">Bulgaria</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-500">
              Electricity supplier
            </span>
            <select
              name="supplierId"
              defaultValue={supplierId ?? ""}
              className={selectClassName}
            >
              <option value="">Not selected</option>

              {regularSuppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.officialLatinName}
                </option>
              ))}

              {specialSuppliers.length > 0 && (
                <option disabled>──────────</option>
              )}

              {specialSuppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.officialLatinName}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex justify-end pt-1">
          <SubmitButton isPending={isPending} label="Save" />
        </div>
      </form>

      <ActionToast result={result} />
    </SettingsCard>
  );
}
