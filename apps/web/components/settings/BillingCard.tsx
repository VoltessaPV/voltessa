"use client";

import { useActionState } from "react";

import { updateBilling, type ActionResult } from "@/app/(platform)/settings/actions";

import { ActionToast } from "./ActionToast";
import { FormField } from "./FormField";
import { SettingsCard } from "./SettingsCard";
import { SubmitButton } from "./SubmitButton";

type BillingCardProps = {
  companyName: string | null;
  uic: string | null;
  vatNumber: string | null;
  country: string | null;
  city: string | null;
  postalCode: string | null;
  address: string | null;
  invoiceEmail: string | null;
};

export function BillingCard(props: BillingCardProps) {
  const [result, formAction, isPending] = useActionState<ActionResult, FormData>(
    updateBilling,
    null,
  );

  return (
    <SettingsCard
      title="Billing Information"
      description="Company details used for invoicing."
    >
      <form action={formAction} className="space-y-4">
        <FormField
          label="Company name"
          name="companyName"
          defaultValue={props.companyName}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="UIC (EIK)" name="uic" defaultValue={props.uic} />
          <FormField
            label="VAT number"
            name="vatNumber"
            defaultValue={props.vatNumber}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Country" name="country" defaultValue={props.country} />
          <FormField label="City" name="city" defaultValue={props.city} />
          <FormField
            label="Postal code"
            name="postalCode"
            defaultValue={props.postalCode}
          />
        </div>

        <FormField label="Address" name="address" defaultValue={props.address} />

        <FormField
          label="Invoice email"
          name="invoiceEmail"
          type="email"
          defaultValue={props.invoiceEmail}
        />

        <div className="flex justify-end pt-1">
          <SubmitButton isPending={isPending} label="Save" />
        </div>
      </form>

      <ActionToast result={result} />
    </SettingsCard>
  );
}
