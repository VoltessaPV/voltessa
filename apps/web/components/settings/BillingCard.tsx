"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { updateBilling, type ActionResult } from "@/app/[locale]/(platform)/settings/actions";

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
  const t = useTranslations("settings.billing");
  const tActions = useTranslations("shared.actions");
  const [result, formAction, isPending] = useActionState<ActionResult, FormData>(
    updateBilling,
    null,
  );

  return (
    <SettingsCard title={t("title")} description={t("description")}>
      <form action={formAction} className="space-y-4">
        <FormField
          label={t("companyNameLabel")}
          name="companyName"
          defaultValue={props.companyName}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t("uicLabel")} name="uic" defaultValue={props.uic} />
          <FormField
            label={t("vatNumberLabel")}
            name="vatNumber"
            defaultValue={props.vatNumber}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label={t("countryLabel")} name="country" defaultValue={props.country} />
          <FormField label={t("cityLabel")} name="city" defaultValue={props.city} />
          <FormField
            label={t("postalCodeLabel")}
            name="postalCode"
            defaultValue={props.postalCode}
          />
        </div>

        <FormField label={t("addressLabel")} name="address" defaultValue={props.address} />

        <FormField
          label={t("invoiceEmailLabel")}
          name="invoiceEmail"
          type="email"
          defaultValue={props.invoiceEmail}
        />

        <div className="flex justify-end pt-1">
          <SubmitButton isPending={isPending} label={tActions("save")} />
        </div>
      </form>

      <ActionToast result={result} />
    </SettingsCard>
  );
}
