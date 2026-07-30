import { prisma } from "@/lib/prisma";

/**
 * Trader Self-Service Onboarding milestone. The single place that decides
 * which stage of onboarding an Energy Trader is in - reused by
 * app/onboarding/page.tsx, app/onboarding/trader-profile/page.tsx,
 * app/onboarding/trader-pending/page.tsx, and
 * lib/auth/session.ts's requireTraderOrganizationAccess(), so all four
 * agree on the same three states instead of re-deriving them separately.
 *
 * - "profile": TraderProfile.onboardingCompletedAt isn't set yet - the
 *   trader must complete their required profile fields first.
 * - "pending": profile complete, but no TraderAssignment exists yet -
 *   waiting for a Platform Admin to assign them to an organization.
 * - "assigned": at least one TraderAssignment exists - full access to
 *   Dashboard/Market/Automations/Alerts/BESS for their assigned org(s).
 */
export type TraderOnboardingStage = "profile" | "pending" | "assigned";

export async function resolveTraderOnboardingStage(
  userId: string,
): Promise<TraderOnboardingStage> {
  const profile = await prisma.traderProfile.findUnique({
    where: { userId },
    select: { onboardingCompletedAt: true },
  });

  if (!profile?.onboardingCompletedAt) {
    return "profile";
  }

  const assignmentCount = await prisma.traderAssignment.count({
    where: { traderId: userId },
  });

  return assignmentCount > 0 ? "assigned" : "pending";
}
