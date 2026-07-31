"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { updateProfile, type ActionResult } from "@/app/[locale]/(platform)/settings/actions";

import { ActionToast } from "./ActionToast";
import { FormField } from "./FormField";
import { SettingsCard } from "./SettingsCard";
import { SubmitButton } from "./SubmitButton";

type ProfileCardProps = {
  firstName: string | null;
  lastName: string | null;
  email: string;
  phone: string | null;
  isGoogleConnected: boolean;
};

export function ProfileCard({
  firstName,
  lastName,
  email,
  phone,
  isGoogleConnected,
}: ProfileCardProps) {
  const t = useTranslations("settings.profile");
  const tActions = useTranslations("shared.actions");
  const [result, formAction, isPending] = useActionState<ActionResult, FormData>(
    updateProfile,
    null,
  );

  return (
    <SettingsCard
      title={t("title")}
      description={t("description")}
      headerAccessory={
        isGoogleConnected ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {t("connectedWithGoogle")}
          </span>
        ) : undefined
      }
    >
      <form action={formAction} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t("firstNameLabel")}
            name="firstName"
            defaultValue={firstName}
            autoComplete="given-name"
          />
          <FormField
            label={t("lastNameLabel")}
            name="lastName"
            defaultValue={lastName}
            autoComplete="family-name"
          />
        </div>

        <FormField
          label={t("emailLabel")}
          name="email"
          type="email"
          defaultValue={email}
          readOnly
        />

        <FormField
          label={t("phoneLabel")}
          name="phone"
          type="tel"
          defaultValue={phone}
          autoComplete="tel"
        />

        <div className="flex justify-end pt-1">
          <SubmitButton isPending={isPending} label={tActions("save")} />
        </div>
      </form>

      <ActionToast result={result} />
    </SettingsCard>
  );
}
