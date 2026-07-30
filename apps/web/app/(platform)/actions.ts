"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  TRADER_SELECTED_ORGANIZATION_COOKIE,
  requireCurrentUser,
  resolveTraderRedirectTarget,
} from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

/**
 * Trader Workspace milestone. The Clients page's (and Dashboard's quick
 * access section's) own Server Action - never trusts the submitted
 * `organizationId` blindly: only writes the cookie if a `TraderAssignment`
 * for this exact trader+organization actually exists. (Even without this
 * check, `requireTraderOrganizationAccess()` would silently fall back to
 * the trader's real first assignment for an invalid cookie value - this
 * just fails closed at write time too, rather than relying on that
 * fallback alone.)
 *
 * Selecting a client is a context switch, not a page navigation - the
 * caller passes its own current path as `redirectTo` so the trader stays
 * on Market/Automations/Alerts/BESS (or wherever they were) with the
 * display now reflecting the new selection, rather than always being
 * bounced to Dashboard. `redirectTo` is untrusted form input, so it's
 * checked against `resolveTraderRedirectTarget`'s fixed allow-list, never
 * redirected to directly - this is exactly the kind of raw user input an
 * open-redirect vulnerability would come from otherwise.
 */
export async function selectTraderOrganization(formData: FormData) {
  const trader = await requireCurrentUser();

  if (trader.accountType !== "ENERGY_TRADER") {
    return;
  }

  const organizationId = formData.get("organizationId")?.toString();
  const redirectTarget = resolveTraderRedirectTarget(formData.get("redirectTo"));

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

  redirect(redirectTarget);
}
