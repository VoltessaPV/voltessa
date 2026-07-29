import { prisma } from "@/lib/prisma";

/**
 * Single source of truth for a user's display name across Administration.
 * `firstName`/`lastName` (written by Settings' own updateProfile and by
 * this module's updateUser/updateTraderProfile) are preferred over the
 * legacy `name` column, which NextAuth's Google flow populates on first
 * sign-in but which stays permanently null for any account created via
 * email/password registration or edited only through the admin panel
 * (updateUser/updateTraderProfile deliberately never touch `name` - see
 * that function's own doc comment) - `name` being null is not the same as
 * the user having no name. Falls back to `name` for whatever legacy rows
 * only ever had that field set; returns null (never a placeholder string)
 * so callers decide their own fallback (email, "—", etc.).
 */
export function resolveUserDisplayName(user: {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): string | null {
  const fromParts = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return fromParts || user.name || null;
}

/**
 * Platform Administration milestone. Every query in this file is
 * deliberately cross-organization — the one sanctioned exception to this
 * app's usual "every query scopes by organizationId" rule (see
 * CODING_STANDARDS.md's multi-tenancy rule), because Platform Admin's own
 * cross-org reach is exactly what ADR-014 designed `isPlatformAdmin` for.
 * Every caller of these functions MUST have already called
 * `requirePlatformAdmin()` — this file does not check authorization itself.
 */

/** Excludes soft-deleted users — see listDeletedUsers() for those. */
export async function listUsers() {
  return prisma.user.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      email: true,
      accountType: true,
      role: true,
      isPlatformAdmin: true,
      deactivatedAt: true,
      createdAt: true,
      organization: { select: { id: true, name: true } },
    },
  });
}

/**
 * Deliberately NOT filtered by deletedAt — the detail page itself checks
 * `deletedAt` and redirects to the Deleted Users view rather than 404ing,
 * so this needs to find the row either way.
 */
export async function getUserById(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      accountType: true,
      role: true,
      isPlatformAdmin: true,
      deactivatedAt: true,
      deletedAt: true,
      createdAt: true,
      organization: { select: { id: true, name: true } },
    },
  });
}

/** Soft-deleted users only — the Deleted Users view's own list. */
export async function listDeletedUsers() {
  return prisma.user.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      email: true,
      accountType: true,
      isPlatformAdmin: true,
      deletedAt: true,
      organization: { select: { id: true, name: true } },
    },
  });
}

export async function listPlantOwnerOrganizations() {
  return prisma.organization.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      plants: { select: { id: true } },
      traderAssignment: {
        select: {
          trader: { select: { id: true, name: true, firstName: true, lastName: true, email: true } },
        },
      },
    },
  });
}

export async function getPlantOwnerOrganizationById(id: string) {
  return prisma.organization.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      createdAt: true,
      users: {
        select: {
          id: true,
          name: true,
          firstName: true,
          lastName: true,
          email: true,
          deactivatedAt: true,
        },
      },
      plants: {
        select: { id: true, name: true, vendor: true, timezone: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
      traderAssignment: {
        select: {
          id: true,
          createdAt: true,
          trader: { select: { id: true, name: true, firstName: true, lastName: true, email: true } },
        },
      },
    },
  });
}

/** Excludes soft-deleted traders — see listDeletedUsers() for those. */
export async function listEnergyTraders() {
  return prisma.user.findMany({
    where: { accountType: "ENERGY_TRADER", deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      deactivatedAt: true,
      createdAt: true,
      traderProfile: {
        select: { companyName: true, distributionCompanyId: true },
      },
      traderAssignments: { select: { organizationId: true } },
    },
  });
}

/** Deliberately NOT filtered by deletedAt — same reasoning as getUserById. */
export async function getEnergyTraderById(id: string) {
  return prisma.user.findUnique({
    where: { id, accountType: "ENERGY_TRADER" },
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      isPlatformAdmin: true,
      deactivatedAt: true,
      deletedAt: true,
      createdAt: true,
      traderProfile: {
        select: { companyName: true, distributionCompanyId: true },
      },
      traderAssignments: {
        select: {
          organization: { select: { id: true, name: true } },
        },
      },
    },
  });
}

/** Active, non-deleted traders only — the assignment dropdown's own source list. */
export async function listAssignableTraders() {
  return prisma.user.findMany({
    where: { accountType: "ENERGY_TRADER", deactivatedAt: null, deletedAt: null },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      email: true,
      traderProfile: { select: { companyName: true } },
    },
  });
}

/** Organizations with no current `TraderAssignment` — the Assignments page's "assign to" candidate list. */
export async function listUnassignedOrganizations() {
  return prisma.organization.findMany({
    where: { traderAssignment: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

export async function listTraderAssignments() {
  return prisma.traderAssignment.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      organization: { select: { id: true, name: true } },
      trader: {
        select: {
          id: true,
          name: true,
          firstName: true,
          lastName: true,
          email: true,
          traderProfile: { select: { companyName: true } },
        },
      },
      assignedBy: {
        select: { id: true, name: true, firstName: true, lastName: true, email: true },
      },
    },
  });
}

export async function listAuditLog(limit = 100) {
  return prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      action: true,
      metadata: true,
      createdAt: true,
      organizationId: true,
      actor: { select: { id: true, name: true, firstName: true, lastName: true, email: true } },
      target: { select: { id: true, name: true, firstName: true, lastName: true, email: true } },
    },
  });
}

export async function getAdminDashboardStats() {
  const [totalPlantOwners, totalEnergyTraders, unassignedPlantOwners, totalPlatformAdmins, recentAuditLog] =
    await Promise.all([
      prisma.organization.count(),
      prisma.user.count({ where: { accountType: "ENERGY_TRADER", deletedAt: null } }),
      prisma.organization.count({ where: { traderAssignment: null } }),
      prisma.user.count({
        where: { isPlatformAdmin: true, deactivatedAt: null, deletedAt: null },
      }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          action: true,
          createdAt: true,
          actor: { select: { name: true, firstName: true, lastName: true, email: true } },
          target: { select: { name: true, firstName: true, lastName: true, email: true } },
        },
      }),
    ]);

  return {
    totalPlantOwners,
    totalEnergyTraders,
    unassignedPlantOwners,
    totalPlatformAdmins,
    recentAuditLog,
  };
}

/**
 * Safety rule: the system must never end up with zero active Platform
 * Admins. Returns true if `userId` is a Platform Admin AND no OTHER
 * active (not deactivated, not deleted) Platform Admin exists — checked
 * regardless of `userId`'s own current active state, so it stays a hard
 * "never allow" invariant rather than something that only fires while the
 * target is still active. Called before deactivate/soft-delete/purge in
 * admin/actions.ts, in addition to (not instead of) the separate
 * "can't act on your own account" guard - self-guard alone can't catch a
 * race between two admins deactivating each other concurrently, this can.
 */
export async function isLastActivePlatformAdmin(userId: string): Promise<boolean> {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { isPlatformAdmin: true },
  });

  if (!target?.isPlatformAdmin) {
    return false;
  }

  const otherActiveAdmins = await prisma.user.count({
    where: {
      isPlatformAdmin: true,
      deactivatedAt: null,
      deletedAt: null,
      id: { not: userId },
    },
  });

  return otherActiveAdmins === 0;
}

export type PurgeEligibility = {
  eligible: boolean;
  blockers: string[];
};

/**
 * Purge's full eligibility algorithm (see ADR discussion) - re-run
 * server-side unconditionally before every purge attempt, never trusted
 * from what the UI last rendered. Blocks the ENTIRE purge if the user's
 * own Organization exists but isn't itself empty - never leaves orphaned
 * business data behind.
 */
export async function getUserPurgeEligibility(userId: string): Promise<PurgeEligibility> {
  const blockers: string[] = [];

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { deletedAt: true, organizationId: true },
  });

  if (!user) {
    return { eligible: false, blockers: ["User not found"] };
  }

  if (!user.deletedAt) {
    blockers.push("User must be soft-deleted before it can be purged");
  }

  const [asTrader, asAssignedBy, asAuditActor, asImpersonationAdmin, asImpersonationTarget] =
    await Promise.all([
      prisma.traderAssignment.count({ where: { traderId: userId } }),
      prisma.traderAssignment.count({ where: { assignedById: userId } }),
      prisma.auditLog.count({ where: { actorUserId: userId } }),
      prisma.impersonationSession.count({ where: { adminUserId: userId } }),
      prisma.impersonationSession.count({ where: { targetUserId: userId } }),
    ]);

  if (asTrader > 0) {
    blockers.push(`Currently assigned as trader to ${asTrader} organization(s)`);
  }
  if (asAssignedBy > 0) {
    blockers.push(`Has granted ${asAssignedBy} trader assignment(s)`);
  }
  if (asAuditActor > 0) {
    blockers.push(`Has ${asAuditActor} audit log entr(ies) as actor`);
  }
  if (asImpersonationAdmin > 0 || asImpersonationTarget > 0) {
    blockers.push("Has impersonation session history");
  }

  if (user.organizationId) {
    const [otherUsers, plants, connections, orgAssignments] = await Promise.all([
      prisma.user.count({
        where: { organizationId: user.organizationId, id: { not: userId } },
      }),
      prisma.plant.count({ where: { organizationId: user.organizationId } }),
      prisma.fusionSolarConnection.count({ where: { organizationId: user.organizationId } }),
      prisma.traderAssignment.count({ where: { organizationId: user.organizationId } }),
    ]);

    if (otherUsers > 0) {
      blockers.push("Organization has other users");
    }
    if (plants > 0) {
      blockers.push(`Organization has ${plants} plant(s)`);
    }
    if (connections > 0) {
      blockers.push("Organization has a FusionSolar connection");
    }
    if (orgAssignments > 0) {
      blockers.push("Organization has a trader assignment");
    }
  }

  return { eligible: blockers.length === 0, blockers };
}
