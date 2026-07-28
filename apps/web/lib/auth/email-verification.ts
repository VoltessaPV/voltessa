import { randomBytes } from "node:crypto";

import { deliverVerificationEmail } from "@/lib/email/templates/verify-email";
import { prisma } from "@/lib/prisma";

const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000;

function buildVerificationUrl(token: string): string {
  const authUrl = process.env.AUTH_URL;
  if (!authUrl) {
    throw new Error("AUTH_URL must be set to build verification email links.");
  }

  return `${authUrl}/verify-email/confirm?token=${token}`;
}

/**
 * The one place an `EmailVerificationToken` is created - registration
 * (`app/create-account/actions.ts`) and resend
 * (`app/verify-email/actions.ts`) both call this instead of duplicating
 * token generation. Deletes any existing token(s) for this user first, so
 * a resend invalidates the previous link (never more than one valid token
 * per user at a time) rather than accumulating rows.
 *
 * `sendEmail` (via `deliverVerificationEmail`) never throws - a delivery
 * failure doesn't roll back the token or fail the calling registration/
 * resend action. The URL is always logged outside production regardless of
 * which provider is active, satisfying "log the verification URL in
 * development" even when the console provider's own HTML dump would
 * otherwise require scanning for it.
 */
export async function sendVerificationEmail(userId: string, email: string): Promise<void> {
  await prisma.emailVerificationToken.deleteMany({ where: { userId } });

  const token = randomBytes(32).toString("hex");

  await prisma.emailVerificationToken.create({
    data: {
      userId,
      token,
      expiresAt: new Date(Date.now() + TOKEN_EXPIRY_MS),
    },
  });

  const verificationUrl = buildVerificationUrl(token);

  if (process.env.NODE_ENV !== "production") {
    console.log(`[Email Verification] Verification URL for ${email}: ${verificationUrl}`);
  }

  await deliverVerificationEmail(email, verificationUrl);
}

export type ConsumeTokenResult =
  | { ok: true }
  | { ok: false; reason: "expired"; email: string }
  | { ok: false; reason: "invalid" };

/**
 * Called only from `app/verify-email/confirm/route.ts`. Single-use: the
 * token row is deleted here on every outcome except "not found" (nothing
 * to delete), so a link can never be replayed - clicking it again after a
 * success or an expiry falls into `reason: "invalid"`, which is an honest
 * description either way ("this link is invalid or has already been used").
 */
export async function consumeEmailVerificationToken(token: string): Promise<ConsumeTokenResult> {
  const record = await prisma.emailVerificationToken.findUnique({
    where: { token },
    select: { id: true, userId: true, expiresAt: true, user: { select: { email: true } } },
  });

  if (!record) {
    return { ok: false, reason: "invalid" };
  }

  await prisma.emailVerificationToken.delete({ where: { id: record.id } });

  if (record.expiresAt < new Date()) {
    return { ok: false, reason: "expired", email: record.user.email ?? "" };
  }

  await prisma.user.update({
    where: { id: record.userId },
    data: { emailVerified: new Date() },
  });

  return { ok: true };
}
