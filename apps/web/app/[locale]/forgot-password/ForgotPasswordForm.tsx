"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/lib/i18n/navigation";
import { useActionState } from "react";

import { AuthField } from "@/components/auth/AuthField";
import { buttonClassName } from "@/components/ui/Button";
import { routes } from "@/lib/routes";

import { requestPasswordReset, type ForgotPasswordResult } from "./actions";

export function ForgotPasswordForm() {
  const t = useTranslations("auth.forgotPassword");
  const tErrors = useTranslations("auth.errors");
  const tSuccess = useTranslations("auth.success");
  const [result, formAction, isPending] = useActionState<ForgotPasswordResult, FormData>(
    requestPasswordReset,
    null,
  );

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-4">
        <AuthField label={t("emailLabel")} name="email" type="email" autoComplete="email" required />

        {result && !isPending && (
          <p className={`text-sm ${result.success ? "text-emerald-400" : "text-red-400"}`}>
            {result.success ? tSuccess(result.code as never) : tErrors(result.code as never)}
          </p>
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

      <p className="text-center text-sm text-slate-400">
        <Link href={routes.login} className="font-medium text-blue-400 transition hover:text-blue-300">
          {t("returnToLoginLink")}
        </Link>
      </p>
    </div>
  );
}
