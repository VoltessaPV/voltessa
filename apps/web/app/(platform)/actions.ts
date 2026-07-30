"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { TRADER_SELECTED_ORGANIZATION_COOKIE, requireCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

/**
 * Trader Self-Service Onboarding milestone. The sidebar org switcher's own
 * Server Action - never trusts the submitted `organizationId` blindly:
 * only writes the cookie if a `TraderAssignment` for this exact
 * trader+organization actually exists. (Even without this check,
 * `requireTraderOrganizationAccess()` would silently fall back to the
 * trader's real first assignment for an invalid cookie value - this just
 * fails closed at write time too, rather than relying on that fallback
 * alone.)
 */
export async function selectTraderOrganization(formData: FormData) {
  const trader = await requireCurrentUser();

  if (trader.accountType !== "ENERGY_TRADER") {
    return;
  }

  const organizationId = formData.get("organizationId")?.toString();
  if (!organizationId) {
    return;
  }

  const assignment = await prisma.traderAssignment.findFirst({
    where: { traderId: trader.id, organizationId },
    select: { id: true },
  });

  if (!assignment) {
    return;
  }

  const cookieStore = await cookies();
  cookieStore.set(TRADER_SELECTED_ORGANIZATION_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });

  redirect("/dashboard");
}
