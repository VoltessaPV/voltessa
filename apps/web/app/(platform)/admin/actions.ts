"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createAuditLog } from "@/lib/admin/audit-log";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { getBulgarianDistributionOperators } from "@/lib/market/distribution/bg";
import { prisma } from "@/lib/prisma";

function optionalString(formData: FormData, field: string): string | null {
  const value = formData.get(field)?.toString().trim();
  return value || null;
}

/** `id !== excludingUserId` check happens at the call site — this only answers "does another row already hold this email". */
async function isEmailTakenByAnotherUser(email: string, excludingUserId: string): Promise<boolean> {
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  return existing !== null && existing.id !== excludingUserId;
}

/**
 * User management. Deliberately touches only identity/profile columns —
 * `firstName`/`lastName`/`phone`/`email`. Never `role`/`accountType`/
 * `isPlatformAdmin` (the authorization model) and never `User.name` (that
 * field is Settings > Profile's own derived-display-name concern; touching
 * it here for an admin who only changed, say, the phone number would wipe
 * a Google-sourced display name for any user who never visited Settings
 * themselves).
 */
export async function updateUser(userId: string, formData: FormData) {
  const admin = await requirePlatformAdmin();

  const email = formData.get("email")?.toString().trim();
  if (!email) {
    redirect(`/admin/users/${userId}?error=email_required`);
  }

  const current = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!current) {
    return;
  }

  if (email !== current.email && (await isEmailTakenByAnotherUser(email, userId))) {
    redirect(`/admin/users/${userId}?error=email_taken`);
  }

  const emailChanged = email !== current.email;

  await prisma.user.update({
    where: { id: userId },
    data: {
      firstName: optionalString(formData, "firstName"),
      lastName: optionalString(formData, "lastName"),
      phone: optionalString(formData, "phone"),
      email,
    },
  });

  await createAuditLog({
    actorUserId: admin.id,
    targetUserId: userId,
    action: "user_updated",
    metadata: emailChanged ? { previousEmail: current.email, newEmail: email } : null,
  });

  // The edited user may be an Energy Trader (this page isn't filtered by
  // accountType) - keep both surfaces for the same underlying User row fresh.
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
  revalidatePath(`/admin/traders/${userId}`);
  revalidatePath("/admin/traders");
  revalidatePath("/admin");
  redirect(`/admin/users/${userId}`);
}

/** Activate/deactivate — reuses `User.deactivatedAt`, the same field Settings/Sprint-1A already established. No new status field. */
export async function toggleUserActive(userId: string) {
  const admin = await requirePlatformAdmin();

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { deactivatedAt: true } });
  if (!user) {
    return;
  }

  const activating = user.deactivatedAt !== null;

  await prisma.user.update({
    where: { id: userId },
    data: { deactivatedAt: activating ? null : new Date() },
  });

  await createAuditLog({
    actorUserId: admin.id,
    targetUserId: userId,
    action: activating ? "user_activated" : "user_deactivated",
  });

  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
  revalidatePath(`/admin/traders/${userId}`);
  revalidatePath("/admin/traders");
  revalidatePath("/admin");
}

/**
 * Trader management. Updates the same identity columns `updateUser` does,
 * plus upserts `TraderProfile` (no self-service UI exists yet — this is
 * the first and, for now, only writer of that row).
 */
export async function updateTraderProfile(userId: string, formData: FormData) {
  const admin = await requirePlatformAdmin();

  const email = formData.get("email")?.toString().trim();
  if (!email) {
    redirect(`/admin/traders/${userId}?error=email_required`);
  }

  const distributionCompanyId = optionalString(formData, "distributionCompanyId");
  if (
    distributionCompanyId &&
    !getBulgarianDistributionOperators().some((operator) => operator.id === distributionCompanyId)
  ) {
    redirect(`/admin/traders/${userId}?error=invalid_distribution_company`);
  }

  const current = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!current) {
    return;
  }

  if (email !== current.email && (await isEmailTakenByAnotherUser(email, userId))) {
    redirect(`/admin/traders/${userId}?error=email_taken`);
  }

  const emailChanged = email !== current.email;
  const companyName = optionalString(formData, "companyName");

  // Both writes are one logical "save trader" action from the admin's point
  // of view - a transaction keeps them from ever partially applying (e.g.
  // identity saved but the profile upsert failing, or vice versa).
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        firstName: optionalString(formData, "firstName"),
        lastName: optionalString(formData, "lastName"),
        phone: optionalString(formData, "phone"),
        email,
      },
    }),
    prisma.traderProfile.upsert({
      where: { userId },
      create: { userId, companyName, distributionCompanyId },
      update: { companyName, distributionCompanyId },
    }),
  ]);

  await createAuditLog({
    actorUserId: admin.id,
    targetUserId: userId,
    action: "trader_profile_updated",
    metadata: emailChanged ? { previousEmail: current.email, newEmail: email } : null,
  });

  // Same underlying User row is also visible from Users - keep it fresh too.
  revalidatePath(`/admin/traders/${userId}`);
  revalidatePath("/admin/traders");
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
  revalidatePath("/admin");
  redirect(`/admin/traders/${userId}`);
}

type AssignmentResult = { ok: true } | { ok: false; reason: "already_assigned" };

/** Shared by both assignment entry points (Plant Owner detail page, top-level Assignments page) — never duplicated. */
async function performAssignTrader(
  organizationId: string,
  traderId: string,
  adminId: string,
): Promise<AssignmentResult> {
  const existing = await prisma.traderAssignment.findUnique({ where: { organizationId } });
  if (existing) {
    return { ok: false, reason: "already_assigned" };
  }

  await prisma.traderAssignment.create({
    data: { organizationId, traderId, assignedById: adminId },
  });

  await createAuditLog({
    actorUserId: adminId,
    targetUserId: traderId,
    organizationId,
    action: "trader_assigned",
  });

  return { ok: true };
}

function revalidateAssignmentPaths(organizationId: string) {
  revalidatePath(`/admin/plant-owners/${organizationId}`);
  revalidatePath("/admin/plant-owners");
  revalidatePath("/admin/assignments");
  revalidatePath("/admin");
}

/** Assign entry point #1 — from a Plant Owner's own detail page (organizationId fixed via `bind`). */
export async function assignTrader(organizationId: string, formData: FormData) {
  const admin = await requirePlatformAdmin();

  const traderId = formData.get("traderId")?.toString();
  if (!traderId) {
    return;
  }

  await performAssignTrader(organizationId, traderId, admin.id);
  revalidateAssignmentPaths(organizationId);
}

/** Assign entry point #2 — the top-level Assignments page, where both the Plant Owner and the trader are chosen in the same form. */
export async function createAssignment(formData: FormData) {
  const admin = await requirePlatformAdmin();

  const organizationId = formData.get("organizationId")?.toString();
  const traderId = formData.get("traderId")?.toString();
  if (!organizationId || !traderId) {
    return;
  }

  await performAssignTrader(organizationId, traderId, admin.id);
  revalidateAssignmentPaths(organizationId);
}

export async function changeTrader(organizationId: string, formData: FormData) {
  const admin = await requirePlatformAdmin();

  const traderId = formData.get("traderId")?.toString();
  if (!traderId) {
    return;
  }

  const existing = await prisma.traderAssignment.findUnique({ where: { organizationId } });
  if (!existing) {
    return;
  }

  await prisma.traderAssignment.update({
    where: { organizationId },
    data: { traderId, assignedById: admin.id },
  });

  await createAuditLog({
    actorUserId: admin.id,
    targetUserId: traderId,
    organizationId,
    action: "trader_changed",
    metadata: { previousTraderId: existing.traderId },
  });

  revalidateAssignmentPaths(organizationId);
}

export async function removeTrader(organizationId: string) {
  const admin = await requirePlatformAdmin();

  const existing = await prisma.traderAssignment.findUnique({ where: { organizationId } });
  if (!existing) {
    return;
  }

  await prisma.traderAssignment.delete({ where: { organizationId } });

  await createAuditLog({
    actorUserId: admin.id,
    targetUserId: existing.traderId,
    organizationId,
    action: "trader_removed",
  });

  revalidateAssignmentPaths(organizationId);
}
