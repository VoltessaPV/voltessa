"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/lib/i18n/navigation";
import { useActionState } from "react";

import { AuthField } from "@/components/auth/AuthField";
import { buttonClassName } from "@/components/ui/Button";
import { routes } from "@/lib/routes";

import { continueWithGoogle, registerWithPassword, type RegisterResult } from "./actions";

export function RegisterForm() {
  const t = useTranslations("auth.register");
  const tErrors = useTranslations("auth.errors");
  const [result, formAction, isPending] = useActionState<RegisterResult, FormData>(
    registerWithPassword,
    null,
  );

  return (
    <div className="space-y-6">
      <form action={continueWithGoogle}>
        <button type="submit" className={buttonClassName("secondary", "w-full text-center")}>
          {t("googleButton")}
        </button>
      </form>

      <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-slate-500">
        <span className="h-px flex-1 bg-white/10" />
        {t("orDivider")}
        <span className="h-px flex-1 bg-white/10" />
      </div>

      <form action={formAction} className="space-y-4">
        <AuthField label={t("emailLabel")} name="email" type="email" autoComplete="email" required />
        <AuthField
          label={t("passwordLabel")}
          name="password"
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

      <p className="text-center text-sm text-slate-400">
        {t("loginPrompt")}{" "}
        <Link href={routes.login} className="font-medium text-blue-400 transition hover:text-blue-300">
          {t("loginLink")}
        </Link>
      </p>
    </div>
  );
}
