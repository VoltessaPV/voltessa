"use server";

import { revalidatePath } from "next/cache";

import { signOut } from "@/auth";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { requireCurrentUser, requireOnboardedUser } from "@/lib/auth/session";
import { getBulgarianDistributionOperators } from "@/lib/market/distribution/bg";
import { getBulgarianElectricitySuppliers } from "@/lib/market/suppliers/bg";
import { prisma } from "@/lib/prisma";

export type ActionResult = { success: boolean; message: string } | null;

const MINIMUM_PASSWORD_LENGTH = 8;

/** Trims a FormData field; empty string becomes `null` (never stored as `""`). */
function readOptionalString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Settings > Profile. `email` is deliberately never read from `formData` —
 * the field is readOnly in the UI, and this is the server-side half of
 * that guarantee: even a hand-crafted request can't change it here.
 * Keeps `User.name` (used by `AppHeader`/`CurrentUser.name` today) in sync
 * from `firstName`/`lastName` so nothing else needs to change to keep
 * showing a sensible display name.
 */
export async function updateProfile(
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireOnboardedUser();

  const firstName = readOptionalString(formData, "firstName");
  const lastName = readOptionalString(formData, "lastName");
  const phone = readOptionalString(formData, "phone");
  const name = [firstName, lastName].filter(Boolean).join(" ") || null;

  await prisma.user.update({
    where: { id: user.id },
    data: { firstName, lastName, phone, name },
  });

  revalidatePath("/settings");

  return { success: true, message: "Profile updated" };
}

/** Settings > Security — only succeeds while the account has no local password yet (re-checked here, never trusted from the client). */
export async function createPassword(
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireOnboardedUser();

  const existing = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });

  if (existing?.passwordHash) {
    return { success: false, message: "A password already exists for this account" };
  }

  const newPassword = formData.get("newPassword");
  const confirmPassword = formData.get("confirmPassword");

  if (typeof newPassword !== "string" || typeof confirmPassword !== "string") {
    return { success: false, message: "New password and confirmation are required" };
  }

  if (newPassword.length < MINIMUM_PASSWORD_LENGTH) {
    return {
      success: false,
      message: `Password must be at least ${MINIMUM_PASSWORD_LENGTH} characters`,
    };
  }

  if (newPassword !== confirmPassword) {
    return { success: false, message: "Passwords do not match" };
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  revalidatePath("/settings");

  return { success: true, message: "Password created" };
}

/** Settings > Security — requires the correct current password before setting a new one. */
export async function changePassword(
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireOnboardedUser();

  const existing = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });

  if (!existing?.passwordHash) {
    return { success: false, message: "No password exists for this account yet" };
  }

  const currentPassword = formData.get("currentPassword");
  const newPassword = formData.get("newPassword");
  const confirmPassword = formData.get("confirmPassword");

  if (
    typeof currentPassword !== "string" ||
    typeof newPassword !== "string" ||
    typeof confirmPassword !== "string"
  ) {
    return { success: false, message: "All password fields are required" };
  }

  const currentPasswordValid = await verifyPassword(
    currentPassword,
    existing.passwordHash,
  );

  if (!currentPasswordValid) {
    return { success: false, message: "Current password is incorrect" };
  }

  if (newPassword.length < MINIMUM_PASSWORD_LENGTH) {
    return {
      success: false,
      message: `Password must be at least ${MINIMUM_PASSWORD_LENGTH} characters`,
    };
  }

  if (newPassword !== confirmPassword) {
    return { success: false, message: "New passwords do not match" };
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  return { success: true, message: "Password changed" };
}

/** Settings > Billing Information — one row per organization, upserted (a first save has no existing row yet). */
export async function updateBilling(
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireOnboardedUser();

  const data = {
    companyName: readOptionalString(formData, "companyName"),
    uic: readOptionalString(formData, "uic"),
    vatNumber: readOptionalString(formData, "vatNumber"),
    country: readOptionalString(formData, "country"),
    city: readOptionalString(formData, "city"),
    postalCode: readOptionalString(formData, "postalCode"),
    address: readOptionalString(formData, "address"),
    invoiceEmail: readOptionalString(formData, "invoiceEmail"),
  };

  await prisma.billingInformation.upsert({
    where: { organizationId: user.organizationId },
    create: { organizationId: user.organizationId, ...data },
    update: data,
  });

  revalidatePath("/settings");

  return { success: true, message: "Billing information saved" };
}

/**
 * Settings > Energy Market. `supplierId`/`dsoId` are each validated against
 * their static list server-side — never trusted as an arbitrary client
 * string, since neither is a database foreign key.
 */
export async function updateEnergyMarket(
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireOnboardedUser();

  const country = readOptionalString(formData, "country") ?? "Bulgaria";
  const supplierId = readOptionalString(formData, "supplierId");
  const dsoId = readOptionalString(formData, "dsoId");

  if (
    supplierId !== null &&
    !getBulgarianElectricitySuppliers().some((supplier) => supplier.id === supplierId)
  ) {
    return { success: false, message: "Unknown electricity supplier" };
  }

  if (
    dsoId !== null &&
    !getBulgarianDistributionOperators().some((operator) => operator.id === dsoId)
  ) {
    return { success: false, message: "Unknown distribution network operator" };
  }

  await prisma.energyMarketSettings.upsert({
    where: { organizationId: user.organizationId },
    create: { organizationId: user.organizationId, country, supplierId, dsoId },
    update: { country, supplierId, dsoId },
  });

  revalidatePath("/settings");

  return { success: true, message: "Energy market settings saved" };
}

/** Settings > Notifications — one row per user. Storage only; not yet read by the notification-dispatch pipeline (see `NotificationPreferences`'s schema doc comment). */
export async function updateNotificationPreferences(
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireOnboardedUser();

  const data = {
    automationChanges: formData.has("automationChanges"),
    exportFailures: formData.has("exportFailures"),
    priceAlerts: formData.has("priceAlerts"),
    dailySummary: formData.has("dailySummary"),
    weeklySummary: formData.has("weeklySummary"),
  };

  await prisma.notificationPreferences.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: data,
  });

  revalidatePath("/settings");

  return { success: true, message: "Notification preferences saved" };
}

/**
 * Settings > Danger Zone. Deletes only the requesting user's own account
 * (`Account`/`Session` cascade via the existing FK `onDelete: Cascade`) —
 * never the Organization or anything beneath it (Plants, FusionSolar
 * connection, telemetry, automation settings/state/events). A user's
 * account is personal identity data; the organization's real operational
 * data belongs to the tenant, not to any one member, and deleting it is
 * far outside what "delete my account" means. `requireCurrentUser` (not
 * `requireOnboardedUser`) — account deletion must work even for a user who
 * never finished onboarding.
 */
export async function deleteAccount(): Promise<void> {
  const user = await requireCurrentUser();

  await prisma.user.delete({ where: { id: user.id } });

  await signOut({ redirectTo: "/" });
}
