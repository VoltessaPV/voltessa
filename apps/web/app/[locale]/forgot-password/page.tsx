import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "@/auth";
import { AuthCard } from "@/components/auth/AuthCard";

import { ForgotPasswordForm } from "./ForgotPasswordForm";

export async function generateMetadata() {
  const t = await getTranslations("auth.forgotPassword");
  return { title: t("title") };
}

export default async function ForgotPasswordPage() {
  const session = await auth();

  if (session?.user?.email) {
    redirect("/dashboard");
  }

  const t = await getTranslations("auth.forgotPassword");

  return (
    <AuthCard title={t("title")} subtitle={t("subtitle")}>
      <ForgotPasswordForm />
    </AuthCard>
  );
}
