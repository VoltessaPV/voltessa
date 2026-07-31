"use server";

import { sendVerificationEmail } from "@/lib/auth/email-verification";
import { prisma } from "@/lib/prisma";

export type ResendResult =
  | { success: true; code: "verificationResent" | "alreadyVerified" }
  | { success: false; code: "emailRequired" | "verificationRateLimited"; params?: { seconds: number } }
  | null;

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
 * new was sent. The 60-second-cooldown message is also not generic (it
 * only ever appears for a real, unverified account) - a deliberate,
 * narrow trade-off for clear spam-prevention feedback, accepted alongside
 * the enumeration-safety choices above rather than silently working
 * around it.
 */
export async function resendVerificationEmail(
  _prevState: ResendResult,
  formData: FormData,
): Promise<ResendResult> {
  const email = formData.get("email");

  if (typeof email !== "string" || !email) {
    return { success: false, code: "emailRequired" };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, emailVerified: true, passwordHash: true },
  });

  if (!user || !user.passwordHash) {
    return { success: true, code: "verificationResent" };
  }

  if (user.emailVerified) {
    return { success: true, code: "alreadyVerified" };
  }

  const result = await sendVerificationEmail(user.id, user.email!);

  if (!result.sent) {
    return {
      success: false,
      code: "verificationRateLimited",
      params: { seconds: result.retryAfterSeconds },
    };
  }

  return { success: true, code: "verificationResent" };
}
