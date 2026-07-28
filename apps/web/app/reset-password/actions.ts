"use server";

import { redirect } from "next/navigation";

import { consumePasswordResetToken } from "@/lib/auth/password-reset";
import { hashPassword, MINIMUM_PASSWORD_LENGTH } from "@/lib/auth/password";
import { prisma } from "@/lib/prisma";

export type ResetPasswordResult = { success: false; message: string } | null;

/**
 * Consumes the token (single-use - see `consumePasswordResetToken`), sets
 * the new password, then deletes every `Session` row for that user - a
 * password reset must invalidate every existing session, on this device
 * and any other, not just leave old sessions valid until they naturally
 * expire. Redirects to /login (never auto-signs in) so the person at the
 * keyboard has to prove they actually have the new password.
 */
export async function resetPassword(
  _prevState: ResetPasswordResult,
  formData: FormData,
): Promise<ResetPasswordResult> {
  const token = formData.get("token");
  const newPassword = formData.get("newPassword");
  const confirmPassword = formData.get("confirmPassword");

  if (
    typeof token !== "string" ||
    !token ||
    typeof newPassword !== "string" ||
    typeof confirmPassword !== "string"
  ) {
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

  const result = await consumePasswordResetToken(token);

  if (!result.ok) {
    return {
      success: false,
      message:
        result.reason === "expired"
          ? "This reset link has expired. Request a new one."
          : "This reset link is invalid or has already been used.",
    };
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.user.update({
    where: { id: result.userId },
    data: { passwordHash },
  });

  await prisma.session.deleteMany({ where: { userId: result.userId } });

  redirect("/login?toast=password-reset");
}
