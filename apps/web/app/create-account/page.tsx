import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AuthCard } from "@/components/auth/AuthCard";

import { RegisterForm } from "./RegisterForm";

export const metadata = {
  title: "Create Account",
};

export default async function CreateAccountPage() {
  const session = await auth();

  if (session?.user?.email) {
    redirect("/dashboard");
  }

  return (
    <AuthCard title="Create your Voltessa account" subtitle="Start operating your plants with Voltessa.">
      <RegisterForm />
    </AuthCard>
  );
}
