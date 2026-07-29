import { forbidden, redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

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
