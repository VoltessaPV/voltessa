import { prisma } from "@/lib/prisma";

/**
 * Trader Workspace milestone. The single place that decides which stage of
 * onboarding an Energy Trader is in - reused by app/onboarding/page.tsx,
 * app/onboarding/trader-profile/page.tsx, and lib/auth/session.ts's
 * requireTraderOrganizationAccess(), so all three agree on the same two
 * states instead of re-deriving them separately.
 *
 * - "profile": TraderProfile.onboardingCompletedAt isn't set yet - the
 *   trader must complete their required profile fields first.
 * - "active": profile complete - full access to the Trader Workspace
 *   (Dashboard/Clients/Market/Automations/Alerts/BESS/Settings), regardless
 *   of assignment count. Zero assigned clients is a normal, permanent
 *   workspace state (an empty Clients portfolio, a portfolio Dashboard
 *   showing zeros), not a separate blocking stage - there is no more
 *   "waiting for assignment" gate anywhere in the app.
 */
export type TraderOnboardingStage = "profile" | "active";

export async function resolveTraderOnboardingStage(
  userId: string,
): Promise<TraderOnboardingStage> {
  const profile = await prisma.traderProfile.findUnique({
    where: { userId },
    select: { onboardingCompletedAt: true },
  });

  return profile?.onboardingCompletedAt ? "active" : "profile";
}
