import Link from "next/link";

import { auth } from "@/auth";
import { AuthCard } from "@/components/auth/AuthCard";
import { buttonClassName } from "@/components/ui/Button";
import { routes } from "@/lib/routes";

import { ResendForm } from "./ResendForm";

export const metadata = {
  title: "Verify Your Email",
};

type VerifyEmailPageProps = {
  searchParams: Promise<{ email?: string; status?: string }>;
};

/**
 * Pure display, driven entirely by query params set by
 * `app/verify-email/confirm/route.ts` (the only place a token is actually
 * consumed), by `registerWithPassword`'s redirect after registration, or
 * by `signInWithPassword`'s redirect when a correct password belongs to
 * an unverified account. No technical detail (token values, database
 * state, provider errors) ever reaches this page - just which of a
 * handful of known states to show.
 */
export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const { email, status } = await searchParams;

  if (status === "success") {
    const session = await auth();
    const isAuthenticated = Boolean(session?.user?.email);

    return (
      <AuthCard title="Email verified successfully" subtitle="Your account is now active.">
        <Link
          href={isAuthenticated ? routes.dashboard : routes.login}
          className={buttonClassName("primary", "block w-full text-center")}
        >
          {isAuthenticated ? "Go to Dashboard" : "Log In"}
        </Link>
      </AuthCard>
    );
  }

  if (status === "expired") {
    return (
      <AuthCard
        title="Verification link expired"
        subtitle="That link is no longer valid, but we can send you a new one."
      >
        {email ? (
          <ResendForm email={email} />
        ) : (
          <Link
            href={routes.createAccount}
            className={buttonClassName("primary", "block w-full text-center")}
          >
            Create an account
          </Link>
        )}
      </AuthCard>
    );
  }

  if (status === "invalid") {
    return (
      <AuthCard
        title="Invalid verification link"
        subtitle="This link is invalid or has already been used."
      >
        <div className="space-y-3">
          <Link
            href={routes.login}
            className={buttonClassName("primary", "block w-full text-center")}
          >
            Log In
          </Link>
          <Link
            href={routes.createAccount}
            className="block text-center text-sm text-slate-400 transition hover:text-white"
          >
            Create an account
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Verify your email"
      subtitle={
        email
          ? `We've sent a verification email to ${email}. Please verify your email before signing in.`
          : "We've sent you a verification email. Please verify your email before signing in."
      }
    >
      <div className="space-y-4">
        {email && <ResendForm email={email} />}

        <div className="space-y-2 text-center text-sm">
          <Link
            href={routes.createAccount}
            className="block text-blue-400 transition hover:text-blue-300"
          >
            Change email address
          </Link>
          <Link href={routes.login} className="block text-slate-400 transition hover:text-white">
            Back to Login
          </Link>
        </div>
      </div>
    </AuthCard>
  );
}
