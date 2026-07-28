"use client";

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

      {result && (
        <p className={`text-sm ${result.success ? "text-emerald-400" : "text-red-400"}`}>
          {result.message}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className={buttonClassName(
          "secondary",
          "w-full text-center disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {isPending ? "Sending..." : "Resend verification email"}
      </button>
    </form>
  );
}
