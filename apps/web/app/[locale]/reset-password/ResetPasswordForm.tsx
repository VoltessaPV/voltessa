"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { AuthField } from "@/components/auth/AuthField";
import { buttonClassName } from "@/components/ui/Button";

import { resetPassword, type ResetPasswordResult } from "./actions";

type ResetPasswordFormProps = {
  token: string;
};

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const t = useTranslations("auth.resetPassword");
  const tErrors = useTranslations("auth.errors");
  const [result, formAction, isPending] = useActionState<ResetPasswordResult, FormData>(
    resetPassword,
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      <AuthField
        label={t("newPasswordLabel")}
        name="newPassword"
        type="password"
        autoComplete="new-password"
        required
      />
      <AuthField
        label={t("confirmPasswordLabel")}
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
      />

      {result && !isPending && !result.success && (
        <p className="text-sm text-red-400">{tErrors(result.code as never, result.params as never)}</p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className={buttonClassName(
          "primary",
          "flex w-full items-center justify-center gap-2 text-center disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        {isPending ? t("submittingButton") : t("submitButton")}
      </button>
    </form>
  );
}
