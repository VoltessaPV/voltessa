"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";

import { buttonClassName } from "@/components/ui/Button";

import { resendVerificationEmail, type ResendResult } from "./actions";

type ResendFormProps = {
  email: string;
};

/**
 * Shared by /verify-email's check-your-inbox/expired states and /login's
 * "please verify your email" branch (`app/login/LoginForm.tsx`) - same
 * form, same action, so there is exactly one resend implementation to
 * reason about.
 */
export function ResendForm({ email }: ResendFormProps) {
  const [result, formAction, isPending] = useActionState<ResendResult, FormData>(
    resendVerificationEmail,
    null,
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="email" value={email} />

      {result && !isPending && (
        <p className={`text-sm ${result.success ? "text-emerald-400" : "text-red-400"}`}>
          {result.message}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className={buttonClassName(
          "secondary",
          "flex w-full items-center justify-center gap-2 text-center disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        {isPending ? "Sending..." : "Resend verification email"}
      </button>
    </form>
  );
}
