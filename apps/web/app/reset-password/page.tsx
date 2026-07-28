import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AuthCard } from "@/components/auth/AuthCard";
import { buttonClassName } from "@/components/ui/Button";
import { routes } from "@/lib/routes";

import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata = {
  title: "Reset Password",
};

type ResetPasswordPageProps = {
  searchParams: Promise<{ token?: string }>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const session = await auth();

  if (session?.user?.email) {
    redirect("/dashboard");
  }

  const { token } = await searchParams;

  if (!token) {
    return (
      <AuthCard
        title="Invalid reset link"
        subtitle="This link is missing or invalid. Request a new one."
      >
        <Link
          href={routes.forgotPassword}
          className={buttonClassName("primary", "block w-full text-center")}
        >
          Request a new link
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Set a new password" subtitle="Choose a new password for your account.">
      <ResetPasswordForm token={token} />
    </AuthCard>
  );
}
