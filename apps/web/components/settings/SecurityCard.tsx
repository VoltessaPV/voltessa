"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import {
  changePassword,
  createPassword,
  type ActionResult,
} from "@/app/[locale]/(platform)/settings/actions";

import { ActionToast } from "./ActionToast";
import { FormField } from "./FormField";
import { SettingsCard } from "./SettingsCard";
import { SubmitButton } from "./SubmitButton";

type SecurityCardProps = {
  isGoogleConnected: boolean;
  hasPassword: boolean;
};

export function SecurityCard({ isGoogleConnected, hasPassword }: SecurityCardProps) {
  const t = useTranslations("settings.security");
  const [createResult, createFormAction, isCreatingPending] = useActionState<
    ActionResult,
    FormData
  >(createPassword, null);
  const [changeResult, changeFormAction, isChangingPending] = useActionState<
    ActionResult,
    FormData
  >(changePassword, null);

  const authenticationLabel = isGoogleConnected
    ? hasPassword
      ? t("googleAndPassword")
      : t("googleAccount")
    : t("password");

  return (
    <SettingsCard title={t("title")} description={t("description")}>
      <div className="space-y-4">
        <div>
          <p className="text-xs font-medium text-slate-500">{t("authenticationLabel")}</p>
          <p className="mt-1 text-sm text-white">{authenticationLabel}</p>
        </div>

        <div className="border-t border-white/10 pt-4">
          {!hasPassword ? (
            <>
              <p className="text-xs font-medium text-slate-500">{t("password")}</p>
              <p className="mt-1 text-sm text-slate-400">{t("noPasswordConfigured")}</p>

              <form action={createFormAction} className="mt-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField
                    label={t("newPasswordLabel")}
                    name="newPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                  />
                  <FormField
                    label={t("confirmPasswordLabel")}
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                  />
                </div>

                <div className="flex justify-end pt-1">
                  <SubmitButton
                    isPending={isCreatingPending}
                    label={t("createPasswordButton")}
                    pendingLabel={t("creatingButton")}
                  />
                </div>
              </form>
            </>
          ) : (
            <form action={changeFormAction} className="space-y-3">
              <FormField
                label={t("currentPasswordLabel")}
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  label={t("newPasswordLabel")}
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                />
                <FormField
                  label={t("confirmPasswordLabel")}
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                />
              </div>

              <div className="flex justify-end pt-1">
                <SubmitButton
                  isPending={isChangingPending}
                  label={t("changePasswordButton")}
                  pendingLabel={t("changingButton")}
                />
              </div>
            </form>
          )}
        </div>

        <div className="border-t border-white/10 pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-white">{t("twoFactorLabel")}</p>
            <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-medium text-slate-500">
              {t("comingSoon")}
            </span>
          </div>
        </div>
      </div>

      <ActionToast result={createResult ?? changeResult} />
    </SettingsCard>
  );
}
