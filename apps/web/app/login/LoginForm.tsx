"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";

import { AuthField } from "@/components/auth/AuthField";
import { buttonClassName } from "@/components/ui/Button";
import { routes } from "@/lib/routes";

import { ResendForm } from "../verify-email/ResendForm";
import { continueWithGoogle, signInWithPassword, type SignInResult } from "./actions";

export function LoginForm() {
  const [result, formAction, isPending] = useActionState<SignInResult, FormData>(
    signInWithPassword,
    null,
  );

  return (
    <div className="space-y-6">
      <form action={continueWithGoogle}>
        <button type="submit" className={buttonClassName("secondary", "w-full text-center")}>
          Continue with Google
        </button>
      </form>

      <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-slate-500">
        <span className="h-px flex-1 bg-white/10" />
        or
        <span className="h-px flex-1 bg-white/10" />
      </div>

      <form action={formAction} className="space-y-4">
        <AuthField label="Email" name="email" type="email" autoComplete="email" required />

        <div>
          <AuthField
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />

          <Link
            href={routes.forgotPassword}
            className="mt-1.5 inline-block text-xs font-medium text-blue-400 transition hover:text-blue-300"
          >
            Forgot password?
          </Link>
        </div>

        {result && !isPending && !result.success && result.reason === "invalid" && (
          <p className="text-sm text-red-400">{result.message}</p>
        )}

        {result && !isPending && !result.success && result.reason === "unverified" && (
          <div className="space-y-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
            <p className="text-sm text-amber-300">{result.message}</p>
            <ResendForm email={result.email} />
          </div>
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
          {isPending ? "Signing in..." : "Log In"}
        </button>
      </form>

      <p className="text-center text-sm text-slate-400">
        New to Voltessa?{" "}
        <Link href={routes.createAccount} className="font-medium text-blue-400 transition hover:text-blue-300">
          Create an account
        </Link>
      </p>
    </div>
  );
}
