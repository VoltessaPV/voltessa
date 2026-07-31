import { getTranslations } from "next-intl/server";
import { Link } from "@/lib/i18n/navigation";

import { auth } from "@/auth";
import { AuthCard } from "@/components/auth/AuthCard";
import { buttonClassName } from "@/components/ui/Button";
import { routes } from "@/lib/routes";

import { ResendForm } from "./ResendForm";

export async function generateMetadata() {
  const t = await getTranslations("auth.verifyEmail");
  return { title: t("title") };
}

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
  const t = await getTranslations("auth.verifyEmail");

  if (status === "success") {
    const session = await auth();
    const isAuthenticated = Boolean(session?.user?.email);

    return (
      <AuthCard title={t("successTitle")} subtitle={t("successSubtitle")}>
        <Link
          href={isAuthenticated ? routes.dashboard : routes.login}
          className={buttonClassName("primary", "block w-full text-center")}
        >
          {isAuthenticated ? t("goToDashboardButton") : t("logInButton")}
        </Link>
      </AuthCard>
    );
  }

  if (status === "expired") {
    return (
      <AuthCard title={t("expiredTitle")} subtitle={t("expiredSubtitle")}>
        {email ? (
          <ResendForm email={email} />
        ) : (
          <Link
            href={routes.createAccount}
            className={buttonClassName("primary", "block w-full text-center")}
          >
            {t("createAccountButton")}
          </Link>
        )}
      </AuthCard>
    );
  }

  if (status === "invalid") {
    return (
      <AuthCard title={t("invalidTitle")} subtitle={t("invalidSubtitle")}>
        <div className="space-y-3">
          <Link
            href={routes.login}
            className={buttonClassName("primary", "block w-full text-center")}
          >
            {t("logInButton")}
          </Link>
          <Link
            href={routes.createAccount}
            className="block text-center text-sm text-slate-400 transition hover:text-white"
          >
            {t("createAccountButton")}
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t("title")}
      subtitle={email ? t("subtitleWithEmail", { email }) : t("subtitleGeneric")}
    >
      <div className="space-y-4">
        {email && <ResendForm email={email} />}

        <div className="space-y-2 text-center text-sm">
          <Link
            href={routes.createAccount}
            className="block text-blue-400 transition hover:text-blue-300"
          >
            {t("changeEmailLink")}
          </Link>
          <Link href={routes.login} className="block text-slate-400 transition hover:text-white">
            {t("backToLoginLink")}
          </Link>
        </div>
      </div>
    </AuthCard>
  );
}
