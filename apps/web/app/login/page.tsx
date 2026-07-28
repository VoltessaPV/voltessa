import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AuthCard } from "@/components/auth/AuthCard";
import { QueryToast } from "@/components/ui/QueryToast";

import { LoginForm } from "./LoginForm";

export const metadata = {
  title: "Log In",
};

export default async function LoginPage() {
  const session = await auth();

  if (session?.user?.email) {
    redirect("/dashboard");
  }

  return (
    <>
      <AuthCard title="Log in to Voltessa" subtitle="Welcome back.">
        <LoginForm />
      </AuthCard>

      <QueryToast />
    </>
  );
}
