import { randomBytes } from "node:crypto";

import { deliverPasswordResetEmail } from "@/lib/email/templates/reset-password";
import { prisma } from "@/lib/prisma";

const TOKEN_EXPIRY_MS = 60 * 60 * 1000;

function buildResetUrl(token: string): string {
  const authUrl = process.env.AUTH_URL;
  if (!authUrl) {
    throw new Error("AUTH_URL must be set to build password reset email links.");
  }

  return `${authUrl}/reset-password?token=${token}`;
}

/**
 * The one place a `PasswordResetToken` is created - called only from
 * `app/forgot-password/actions.ts`, and only for an account that already
 * has a password (a Google-only account has nothing to reset - see that
 * action's own enumeration-safety handling). Deletes any existing token(s)
 * for this user first, so a new request invalidates a previous one, same
 * pattern as `sendVerificationEmail`.
 */
export async function sendPasswordResetEmail(userId: string, email: string): Promise<void> {
  await prisma.passwordResetToken.deleteMany({ where: { userId } });

  const token = randomBytes(32).toString("hex");

  await prisma.passwordResetToken.create({
    data: {
      userId,
      token,
      expiresAt: new Date(Date.now() + TOKEN_EXPIRY_MS),
    },
  });

  const resetUrl = buildResetUrl(token);

  if (process.env.NODE_ENV !== "production") {
    console.log(`[Password Reset] Reset URL for ${email}: ${resetUrl}`);
  }

  await deliverPasswordResetEmail(email, resetUrl, userId);
}

export type ConsumeResetTokenResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "expired" }
  | { ok: false; reason: "invalid" };

/**
 * Called only from `app/reset-password/actions.ts`'s `resetPassword`.
 * Single-use: the token row is deleted here on every outcome except "not
 * found" (nothing to delete), so a link can never be replayed.
 */
export async function consumePasswordResetToken(token: string): Promise<ConsumeResetTokenResult> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { token },
    select: { id: true, userId: true, expiresAt: true },
  });

  if (!record) {
    return { ok: false, reason: "invalid" };
  }

  await prisma.passwordResetToken.delete({ where: { id: record.id } });

  if (record.expiresAt < new Date()) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, userId: record.userId };
}
