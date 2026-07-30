import type { AccountType } from "@prisma/client";
import { cookies } from "next/headers";
import { forbidden, redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

import { resolveTraderOnboardingStage } from "./trader-onboarding";
import type { Role } from "./roles";

export type CurrentOrganization = {
  id: string;
  name: string;
  onboardingCompletedAt: Date | null;
};

export type CurrentUser = {
  id: string;
  name: string | null;
  email: string;
  role: Role;
  organizationId: string | null;
  organization: CurrentOrganization | null;
  /** Cross-organization staff flag — see ADR-014. Never used by `Permissions.can*`/`role`. */
  isPlatformAdmin: boolean;
  /** Commercial persona only — see ADR-014. Used here solely to branch between the owner and Trader Self-Service org-resolution paths (session.ts), never as an authorization check. */
  accountType: AccountType;
};

export type CurrentUserWithOrganization = CurrentUser & {
  organizationId: string;
  organization: CurrentOrganization;
};

async function findCurrentUserByEmail(
  email: string,
): Promise<CurrentUser | null> {
  const user = await prisma.user.findUnique({
    where: {
      email,
      // Platform Administration milestone. A deactivated or soft-deleted
      // user must not authenticate - this is the one query behind
      // getCurrentUser(), so every gate below (requireCurrentUser,
      // requireOnboardedUser, requirePermission, requirePlatformAdmin)
      // inherits this for free. This is what cuts off an ALREADY-active
      // session the moment an admin deactivates/deletes someone - the
      // sign-in-time checks in lib/auth/config.ts and app/login/actions.ts
      // only stop a NEW login, they don't touch an existing Session row.
      deletedAt: null,
      deactivatedAt: null,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isPlatformAdmin: true,
      accountType: true,
      organizationId: true,
      organization: {
        select: {
          id: true,
          name: true,
          onboardingCompletedAt: true,
        },
      },
    },
  });

  if (!user?.email) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isPlatformAdmin: user.isPlatformAdmin,
    accountType: user.accountType,
    organizationId: user.organizationId,
    organization: user.organization,
  };
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();

  if (!session?.user?.email) {
    return null;
  }

  return findCurrentUserByEmail(session.user.email);
}

export async function requireCurrentUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}

export async function requireOnboardedUser(): Promise<CurrentUserWithOrganization> {
  const user = await requireCurrentUser();

  if (!user.organizationId || !user.organization?.onboardingCompletedAt) {
    redirect("/onboarding");
  }

  return {
    ...user,
    organizationId: user.organizationId!,
    organization: user.organization!,
  };
}

export async function requirePermission(
  allowedRoles: readonly Role[],
): Promise<CurrentUserWithOrganization> {
  const user = await requireOnboardedUser();

  if (!allowedRoles.includes(user.role)) {
    forbidden();
  }

  return user;
}

/**
 * Platform Administration milestone. Gates on `User.isPlatformAdmin`
 * (ADR-014) — a separate, orthogonal check from `Permissions.can*`/`role`,
 * never mixed with it. Built on `requireCurrentUser()` rather than
 * `requireOnboardedUser()` deliberately: Platform Admin is a
 * cross-organization concern and shouldn't require the caller to own an
 * Organization, even though every real admin today happens to have one
 * (see ADR-015's bootstrap SOP). Every Server Action under `admin/actions.ts`
 * calls this itself — the `(platform)/admin` layout also calls it, but a
 * layout render never protects a Server Action's own RPC.
 */
export async function requirePlatformAdmin(): Promise<CurrentUser> {
  const user = await requireCurrentUser();

  if (!user.isPlatformAdmin) {
    forbidden();
  }

  return user;
}

/** Cookie holding the assigned Organization currently selected by a multi-assignment trader. Never trusted blindly - see selectTraderOrganization in app/(platform)/actions.ts, which re-validates the id against the trader's own TraderAssignment rows before writing this. */
export const TRADER_SELECTED_ORGANIZATION_COOKIE = "voltessa-trader-org";

export type CurrentTraderOrganization = {
  id: string;
  name: string;
};

export type CurrentTraderAccess = {
  trader: CurrentUser;
  /** Null when this trader has zero `TraderAssignment` rows - a normal, permanent Trader Workspace state, not an error. */
  organizationId: string | null;
  organization: CurrentTraderOrganization | null;
  /** Every organization this trader is assigned to - drives the header's client-context indicator and the Clients portfolio page. */
  assignedOrganizations: CurrentTraderOrganization[];
};

/**
 * Trader Workspace milestone. The Energy Trader counterpart to
 * `requireOnboardedUser()` — deliberately a SEPARATE function, not a
 * branch inside it: `requireOnboardedUser()` stays exactly what it always
 * was (ownership via `User.organizationId`), so every page that still
 * calls it (Plants, Settings, Administration, and anything else not
 * explicitly updated for this milestone) continues to reject a Trader
 * automatically, with zero changes to that function or those pages. Only
 * the pages Traders may see (Dashboard/Clients/Market/Automations/Alerts/
 * BESS) call this instead.
 *
 * Resolves onboarding stage first (see `resolveTraderOnboardingStage`) -
 * redirects back into the onboarding flow if the trader's profile isn't
 * complete yet, exactly like `requireOnboardedUser` redirects an
 * incomplete Plant Owner to `/onboarding`. Once the profile is complete,
 * the trader always enters the workspace — zero assignments is never a
 * redirect, it's returned as `organizationId: null` for the caller to
 * render its own empty state. The selected organization (for a trader
 * assigned to more than one) comes from `TRADER_SELECTED_ORGANIZATION_COOKIE`,
 * falling back to the most recently assigned organization if unset or no
 * longer valid (e.g. an assignment was removed since the cookie was
 * written).
 */
export async function requireTraderOrganizationAccess(): Promise<CurrentTraderAccess> {
  const trader = await requireCurrentUser();

  if (trader.accountType !== "ENERGY_TRADER") {
    redirect("/dashboard");
  }

  const stage = await resolveTraderOnboardingStage(trader.id);

  if (stage === "profile") {
    redirect("/onboarding/trader-profile");
  }

  const assignments = await prisma.traderAssignment.findMany({
    where: { traderId: trader.id },
    orderBy: { createdAt: "desc" },
    select: {
      organization: {
        select: { id: true, name: true },
      },
    },
  });

  const assignedOrganizations = assignments.map((assignment) => assignment.organization);
  const firstOrganization = assignedOrganizations[0];

  if (!firstOrganization) {
    return {
      trader,
      organizationId: null,
      organization: null,
      assignedOrganizations: [],
    };
  }

  const cookieStore = await cookies();
  const selectedId = cookieStore.get(TRADER_SELECTED_ORGANIZATION_COOKIE)?.value;
  const selectedOrganization =
    assignedOrganizations.find((organization) => organization.id === selectedId) ?? firstOrganization;

  return {
    trader,
    organizationId: selectedOrganization.id,
    organization: selectedOrganization,
    assignedOrganizations,
  };
}

export type OrganizationViewAccess = {
  /** Null for an Energy Trader with zero assigned clients. */
  organizationId: string | null;
  /** True for an assigned Energy Trader - callers must not render any write control (forms, CTAs like "Connect Plant") when this is true. */
  readOnly: boolean;
};

/**
 * Trader Workspace milestone. Shared by every page a Trader may view -
 * Market, Alerts, BESS - to resolve both which organization to render and
 * whether the caller must suppress write controls (e.g.
 * `ConnectFusionSolarButton`'s empty-state CTA, which starts a real OAuth
 * flow that would modify the organization). `organizationId` is null when
 * the trader has no assigned clients - callers render their own empty
 * state rather than treating this as an error.
 *
 * Deliberately NOT used by Automations: that page gates the *owner* path
 * on `requirePermission(Permissions.canManagePlants)`, a stricter check
 * than plain ownership - reusing this helper's `requireOnboardedUser()`
 * fallback there would silently downgrade that check. Automations builds
 * the same `{ organizationId, readOnly }` shape itself, from its own
 * explicit branch, instead (see that page). Also deliberately NOT used by
 * Dashboard, which is portfolio-level for a trader and never resolves a
 * single "current" organization to render.
 */
export async function resolveOrganizationViewAccess(): Promise<OrganizationViewAccess> {
  const identity = await requireCurrentUser();

  if (identity.accountType === "ENERGY_TRADER") {
    const access = await requireTraderOrganizationAccess();
    return { organizationId: access.organizationId, readOnly: true };
  }

  const user = await requireOnboardedUser();
  return { organizationId: user.organizationId, readOnly: false };
}

/** Fixed set of routes a Trader select-client form may redirect back to — never trust a raw `redirectTo` form value without checking it against this list (open-redirect prevention). */
const TRADER_REDIRECT_ALLOWLIST = [
  "/dashboard",
  "/clients",
  "/market",
  "/automations",
  "/alerts",
  "/bess",
] as const;

export function resolveTraderRedirectTarget(candidate: FormDataEntryValue | null): string {
  const value = candidate?.toString();
  return (TRADER_REDIRECT_ALLOWLIST as readonly string[]).includes(value ?? "")
    ? value!
    : "/dashboard";
}
