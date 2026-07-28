"use client";

import Link from "next/link";
import { useActionState } from "react";

import { AuthField } from "@/components/auth/AuthField";
import { buttonClassName } from "@/components/ui/Button";
import { routes } from "@/lib/routes";

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
        <AuthField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />

        {result && !result.success && <p className="text-sm text-red-400">{result.message}</p>}

        <button
          type="submit"
          disabled={isPending}
          className={buttonClassName(
            "primary",
            "w-full text-center disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
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
