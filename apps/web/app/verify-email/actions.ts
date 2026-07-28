"use server";

import { sendVerificationEmail } from "@/lib/auth/email-verification";
import { prisma } from "@/lib/prisma";

export type ResendResult = { success: boolean; message: string } | null;

const GENERIC_MESSAGE = "If that email needs verification, we've sent a new link.";

/**
 * Reused from both the /verify-email check-your-inbox page and the
 * "please verify your email" branch of /login's form (see
 * `app/login/LoginForm.tsx`) - one implementation, not two. Enumeration-
 * safe for the two sensitive cases (no account for that email at all, or
 * the account is Google-only and never had a password to verify) - both
 * return the exact same generic message as a genuine send, without
 * creating a token or calling the email service. "Already verified" is
 * deliberately NOT generic: telling someone their account is already
 * verified reveals nothing an attacker couldn't already learn by simply
 * trying to log in, and it's the literal, helpful answer to why nothing
 * new was sent.
 */
export async function resendVerificationEmail(
  _prevState: ResendResult,
  formData: FormData,
): Promise<ResendResult> {
  const email = formData.get("email");

  if (typeof email !== "string" || !email) {
    return { success: false, message: "Email is required" };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, emailVerified: true, passwordHash: true },
  });

  if (!user || !user.passwordHash) {
    return { success: true, message: GENERIC_MESSAGE };
  }

  if (user.emailVerified) {
    return { success: true, message: "This account is already verified — you can log in." };
  }

  await sendVerificationEmail(user.id, user.email!);

  return { success: true, message: GENERIC_MESSAGE };
}
