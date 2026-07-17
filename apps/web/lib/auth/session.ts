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
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
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
