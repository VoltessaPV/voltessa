"use client";

import { useActionState } from "react";

import { updateEnergyMarket, type ActionResult } from "@/app/(platform)/settings/actions";
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

const selectClassName =
  "h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white outline-none transition focus:border-white/20";

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
  const [result, formAction, isPending] = useActionState<ActionResult, FormData>(
    updateEnergyMarket,
    null,
  );

  const suppliers = getBulgarianElectricitySuppliers();
  const regularSuppliers = suppliers.filter((supplier) => !supplier.special);
  const specialSuppliers = suppliers.filter((supplier) => supplier.special);

  const operators = getBulgarianDistributionOperators();

  return (
    <SettingsCard
      title="Energy Market"
      description="Country, electricity supplier, and distribution network operator for this organization."
    >
      <form action={formAction} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
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
                  {supplier.officialBulgarianName}
                </option>
              ))}

              {specialSuppliers.length > 0 && (
                <option disabled>──────────</option>
              )}

              {specialSuppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.officialBulgarianName}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-500">
              Distribution Network Operator
            </span>
            <select
              name="dsoId"
              defaultValue={dsoId ?? ""}
              className={selectClassName}
            >
              <option value="">Not selected</option>

              {operators.map((operator) => (
                <option key={operator.id} value={operator.id}>
                  {operator.officialBulgarianName}
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
