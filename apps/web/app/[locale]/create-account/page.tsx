import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "@/auth";
import { AuthCard } from "@/components/auth/AuthCard";

import { RegisterForm } from "./RegisterForm";

export async function generateMetadata() {
  const t = await getTranslations("auth.register");
  return { title: t("title") };
}

export default async function CreateAccountPage() {
  const session = await auth();

  if (session?.user?.email) {
    redirect("/dashboard");
  }

  const t = await getTranslations("auth.register");

  return (
    <AuthCard title={t("title")} subtitle={t("subtitle")}>
      <RegisterForm />
    </AuthCard>
  );
}
