"use server";

import { sendPasswordResetEmail } from "@/lib/auth/password-reset";
import { prisma } from "@/lib/prisma";

export type ForgotPasswordResult = { success: boolean; message: string } | null;

const GENERIC_MESSAGE = "If that email has a Voltessa account, we've sent a password reset link.";

/**
 * Enumeration-safe: identical response whether the email doesn't exist at
 * all, or exists but is Google-only (no `passwordHash` - nothing to
 * reset; linking a password onto a Google account is a later phase, not
 * this flow). Only an account that actually has a password gets an email.
 */
export async function requestPasswordReset(
  _prevState: ForgotPasswordResult,
  formData: FormData,
): Promise<ForgotPasswordResult> {
  const email = formData.get("email");

  if (typeof email !== "string" || !email) {
    return { success: false, message: "Email is required" };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, passwordHash: true },
  });

  if (user?.passwordHash) {
    await sendPasswordResetEmail(user.id, user.email!);
  }

  return { success: true, message: GENERIC_MESSAGE };
}
