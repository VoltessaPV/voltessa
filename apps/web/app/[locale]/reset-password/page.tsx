import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/lib/i18n/navigation";

import { auth } from "@/auth";
import { AuthCard } from "@/components/auth/AuthCard";
import { buttonClassName } from "@/components/ui/Button";
import { routes } from "@/lib/routes";

import { ResetPasswordForm } from "./ResetPasswordForm";

export async function generateMetadata() {
  const t = await getTranslations("auth.resetPassword");
  return { title: t("title") };
}

type ResetPasswordPageProps = {
  searchParams: Promise<{ token?: string }>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const session = await auth();

  if (session?.user?.email) {
    redirect("/dashboard");
  }

  const { token } = await searchParams;
  const t = await getTranslations("auth.resetPassword");

  if (!token) {
    return (
      <AuthCard title={t("invalidLinkTitle")} subtitle={t("invalidLinkSubtitle")}>
        <Link
          href={routes.forgotPassword}
          className={buttonClassName("primary", "block w-full text-center")}
        >
          {t("requestNewLinkButton")}
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("title")} subtitle={t("subtitle")}>
      <ResetPasswordForm token={token} />
    </AuthCard>
  );
}
