import { prisma } from "@/lib/prisma";

/**
 * Platform Administration milestone. Every query in this file is
 * deliberately cross-organization — the one sanctioned exception to this
 * app's usual "every query scopes by organizationId" rule (see
 * CODING_STANDARDS.md's multi-tenancy rule), because Platform Admin's own
 * cross-org reach is exactly what ADR-014 designed `isPlatformAdmin` for.
 * Every caller of these functions MUST have already called
 * `requirePlatformAdmin()` — this file does not check authorization itself.
 */

export async function listUsers() {
  return prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
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
      createdAt: true,
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
          trader: { select: { id: true, name: true, email: true } },
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
      onboardingCompletedAt: true,
      users: {
        select: { id: true, name: true, email: true, deactivatedAt: true },
      },
      plants: {
        select: { id: true, name: true, vendor: true, timezone: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
      traderAssignment: {
        select: {
          id: true,
          createdAt: true,
          trader: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });
}

export async function listEnergyTraders() {
  return prisma.user.findMany({
    where: { accountType: "ENERGY_TRADER" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
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
      deactivatedAt: true,
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

/** Active (non-deactivated) traders only — the assignment dropdown's own source list. */
export async function listAssignableTraders() {
  return prisma.user.findMany({
    where: { accountType: "ENERGY_TRADER", deactivatedAt: null },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
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
          email: true,
          traderProfile: { select: { companyName: true } },
        },
      },
      assignedBy: { select: { id: true, name: true, email: true } },
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
      actor: { select: { id: true, name: true, email: true } },
      target: { select: { id: true, name: true, email: true } },
    },
  });
}

export async function getAdminDashboardStats() {
  const [totalPlantOwners, totalEnergyTraders, unassignedPlantOwners, totalPlatformAdmins, recentAuditLog] =
    await Promise.all([
      prisma.organization.count(),
      prisma.user.count({ where: { accountType: "ENERGY_TRADER" } }),
      prisma.organization.count({ where: { traderAssignment: null } }),
      prisma.user.count({ where: { isPlatformAdmin: true } }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          action: true,
          createdAt: true,
          actor: { select: { name: true, email: true } },
          target: { select: { name: true, email: true } },
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
