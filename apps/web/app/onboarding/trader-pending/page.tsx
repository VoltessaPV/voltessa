import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { resolveTraderOnboardingStage } from "@/lib/auth/trader-onboarding";
import { prisma } from "@/lib/prisma";

/**
 * Trader Self-Service Onboarding milestone. The "waiting for assignment"
 * state - reached only after `resolveTraderOnboardingStage` confirms the
 * trader's profile is complete but no `TraderAssignment` exists yet.
 * Re-checked on every visit (not a one-time redirect target): the moment
 * a Platform Admin creates an assignment, the trader's very next visit
 * here (or anywhere under `(platform)`, via `requireTraderOrganizationAccess`)
 * redirects straight to `/dashboard` - no separate "you've been assigned"
 * notification exists, this page's own re-check is what surfaces it.
 */
export default async function TraderPendingPage() {
  const session = await auth();

  if (!session?.user?.email) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, accountType: true },
  });

  if (!user) {
    redirect("/login");
  }

  if (user.accountType !== "ENERGY_TRADER") {
    redirect("/onboarding");
  }

  const stage = await resolveTraderOnboardingStage(user.id);

  if (stage === "profile") {
    redirect("/onboarding/trader-profile");
  }

  if (stage === "assigned") {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#050816] px-6 text-white">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
        <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-amber-400/30 bg-amber-400/10 text-amber-300">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            className="h-5 w-5"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>

        <h1 className="mt-4 text-2xl font-semibold">Waiting for assignment</h1>

        <p className="mt-4 text-sm text-white/60">
          Your Energy Trader profile has been submitted successfully. A Platform Administrator
          will assign you to one or more organizations shortly — you&apos;ll get access to their
          plant and market data as soon as that happens.
        </p>
      </div>
    </main>
  );
}
