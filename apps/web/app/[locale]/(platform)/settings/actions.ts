"use server";

import { revalidatePath } from "next/cache";

import { signOut } from "@/auth";
import { hashPassword, MINIMUM_PASSWORD_LENGTH, verifyPassword } from "@/lib/auth/password";
import { requireCurrentUser, requireOnboardedUser } from "@/lib/auth/session";
import { getBulgarianDistributionOperators } from "@/lib/market/distribution/bg";
import { getBulgarianElectricitySuppliers } from "@/lib/market/suppliers/bg";
import { prisma } from "@/lib/prisma";

export type ActionResultCode =
  | "profileUpdated"
  | "passwordAlreadyExists"
  | "passwordFieldsRequired"
  | "passwordTooShort"
  | "passwordsDoNotMatch"
  | "passwordCreated"
  | "noPasswordExists"
  | "allPasswordFieldsRequired"
  | "currentPasswordIncorrect"
  | "newPasswordsDoNotMatch"
  | "passwordChanged"
  | "billingSaved"
  | "unknownSupplier"
  | "unknownDso"
  | "energyMarketSaved"
  | "notificationPreferencesSaved";

export type ActionResult =
  | { success: boolean; code: ActionResultCode; params?: { min: number } }
  | null;

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
 *
 * `requireCurrentUser` (not `requireOnboardedUser`) — same reasoning as
 * `deleteAccount` below: this only ever touches `user.id`, never
 * `organizationId`, so it must work for an Energy Trader too (who never
 * owns an Organization at all, not just one mid-onboarding).
 */
export async function updateProfile(
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireCurrentUser();

  const firstName = readOptionalString(formData, "firstName");
  const lastName = readOptionalString(formData, "lastName");
  const phone = readOptionalString(formData, "phone");
  const name = [firstName, lastName].filter(Boolean).join(" ") || null;

  await prisma.user.update({
    where: { id: user.id },
    data: { firstName, lastName, phone, name },
  });

  revalidatePath("/settings");

  return { success: true, code: "profileUpdated" };
}

/**
 * Settings > Security — only succeeds while the account has no local
 * password yet (re-checked here, never trusted from the client).
 * `requireCurrentUser` - only touches `user.id`, same reasoning as
 * `updateProfile` above.
 */
export async function createPassword(
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireCurrentUser();

  const existing = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });

  if (existing?.passwordHash) {
    return { success: false, code: "passwordAlreadyExists" };
  }

  const newPassword = formData.get("newPassword");
  const confirmPassword = formData.get("confirmPassword");

  if (typeof newPassword !== "string" || typeof confirmPassword !== "string") {
    return { success: false, code: "passwordFieldsRequired" };
  }

  if (newPassword.length < MINIMUM_PASSWORD_LENGTH) {
    return {
      success: false,
      code: "passwordTooShort",
      params: { min: MINIMUM_PASSWORD_LENGTH },
    };
  }

  if (newPassword !== confirmPassword) {
    return { success: false, code: "passwordsDoNotMatch" };
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  revalidatePath("/settings");

  return { success: true, code: "passwordCreated" };
}

/**
 * Settings > Security — requires the correct current password before
 * setting a new one. `requireCurrentUser` - same reasoning as
 * `updateProfile` above.
 */
export async function changePassword(
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireCurrentUser();

  const existing = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });

  if (!existing?.passwordHash) {
    return { success: false, code: "noPasswordExists" };
  }

  const currentPassword = formData.get("currentPassword");
  const newPassword = formData.get("newPassword");
  const confirmPassword = formData.get("confirmPassword");

  if (
    typeof currentPassword !== "string" ||
    typeof newPassword !== "string" ||
    typeof confirmPassword !== "string"
  ) {
    return { success: false, code: "allPasswordFieldsRequired" };
  }

  const currentPasswordValid = await verifyPassword(
    currentPassword,
    existing.passwordHash,
  );

  if (!currentPasswordValid) {
    return { success: false, code: "currentPasswordIncorrect" };
  }

  if (newPassword.length < MINIMUM_PASSWORD_LENGTH) {
    return {
      success: false,
      code: "passwordTooShort",
      params: { min: MINIMUM_PASSWORD_LENGTH },
    };
  }

  if (newPassword !== confirmPassword) {
    return { success: false, code: "newPasswordsDoNotMatch" };
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  return { success: true, code: "passwordChanged" };
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

  return { success: true, code: "billingSaved" };
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
    return { success: false, code: "unknownSupplier" };
  }

  if (
    dsoId !== null &&
    !getBulgarianDistributionOperators().some((operator) => operator.id === dsoId)
  ) {
    return { success: false, code: "unknownDso" };
  }

  await prisma.energyMarketSettings.upsert({
    where: { organizationId: user.organizationId },
    create: { organizationId: user.organizationId, country, supplierId, dsoId },
    update: { country, supplierId, dsoId },
  });

  revalidatePath("/settings");

  return { success: true, code: "energyMarketSaved" };
}

/**
 * Settings > Notifications — one row per user. Storage only; not yet read
 * by the notification-dispatch pipeline (see `NotificationPreferences`'s
 * schema doc comment). `requireCurrentUser` - keyed by `userId` alone,
 * same reasoning as `updateProfile` above.
 */
export async function updateNotificationPreferences(
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireCurrentUser();

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

  return { success: true, code: "notificationPreferencesSaved" };
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
 *
 * GDPR + Cookie Consent Platform milestone: also writes an
 * `AccountDeletionRecord` — deliberately NOT the general-purpose `AuditLog`
 * (see that model's own schema comment for why) — in the same transaction
 * as the delete, so the audit trail and the deletion always succeed or fail
 * together. The record is created with a fixed, no-PII shape; nothing about
 * `user` (id/email/name) is ever passed into it.
 */
export async function deleteAccount(): Promise<void> {
  const user = await requireCurrentUser();

  await prisma.$transaction([
    prisma.accountDeletionRecord.create({
      data: { correlationId: crypto.randomUUID() },
    }),
    prisma.user.delete({ where: { id: user.id } }),
  ]);

  await signOut({ redirectTo: "/" });
}
