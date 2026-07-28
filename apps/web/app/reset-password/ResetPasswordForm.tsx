"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";

import { AuthField } from "@/components/auth/AuthField";
import { buttonClassName } from "@/components/ui/Button";

import { resetPassword, type ResetPasswordResult } from "./actions";

type ResetPasswordFormProps = {
  token: string;
};

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const [result, formAction, isPending] = useActionState<ResetPasswordResult, FormData>(
    resetPassword,
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      <AuthField
        label="New password"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        required
      />
      <AuthField
        label="Confirm password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
      />

      {result && !isPending && !result.success && (
        <p className="text-sm text-red-400">{result.message}</p>
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
        {isPending ? "Resetting..." : "Reset Password"}
      </button>
    </form>
  );
}
