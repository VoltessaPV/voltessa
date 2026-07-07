import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

import { createOrganization } from "./actions";

export default async function OnboardingPage() {
  const session = await auth();

  if (!session?.user?.email) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: {
      email: session.user.email,
    },
    select: {
      organization: {
        select: {
          name: true,
          onboardingCompletedAt: true,
        },
      },
    },
  });

  if (user?.organization?.onboardingCompletedAt) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#050816] px-6 text-white">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8">
        <h1 className="text-2xl font-semibold">
          Set up your organization
        </h1>

        <p className="mt-2 text-sm text-white/60">
          Create your Voltessa workspace to start managing plants and energy
          operations.
        </p>

        <form action={createOrganization} className="mt-8">
          <label
            htmlFor="name"
            className="text-sm font-medium text-white/80"
          >
            Organization name
          </label>

          <input
            id="name"
            name="name"
            type="text"
            required
            defaultValue={user?.organization?.name ?? ""}
            className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none transition focus:border-blue-500"
          />

          <button
            type="submit"
            className="mt-6 w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold transition hover:bg-blue-500"
          >
            Continue to dashboard
          </button>
        </form>
      </div>
    </main>
  );
}