import { prisma } from "@/lib/prisma";
import { verifyGoogleIdToken } from "@/lib/auth/verify-google-id-token";

/**
 * Mobile Client Architecture (ADR-020), M5. The Google counterpart to
 * `authenticate-with-password.ts`'s `authenticateWithPassword` - same
 * shape of result, same "resolve identity, never redirect/set a session
 * itself" contract, so `google-sign-in/route.ts` can share
 * `mint-mobile-session.ts`'s tail with the password sign-in route
 * unchanged.
 *
 * Deliberately stricter than Web's own Google sign-in
 * (`lib/auth/config.ts`), which - via NextAuth's default `PrismaAdapter`
 * behavior - auto-creates a brand-new `User` the first time a given
 * Google account signs in. This function never does that: it only ever
 * signs in an ALREADY-linked account (an existing `Account` row with
 * `provider: "google"`). Reasons this is a deliberate, narrower policy,
 * not an oversight:
 *   - Android has no onboarding UI - a freshly auto-created,
 *     organization-less user would be a dead end here in a way it isn't
 *     on Web (which redirects straight into `/onboarding`).
 *   - It matches `authenticateWithPassword`'s own behavior, which also
 *     only ever signs in an existing `User` row and never creates one -
 *     the two mobile credential paths now behave consistently with each
 *     other, not just each independently with their own Web counterpart.
 *   - It matches Auth.js's own default anti-account-hijack behavior for
 *     an UNLINKED email/password account with the same email
 *     (`allowDangerousEmailAccountLinking` is not set on Web's Google
 *     provider, so Web itself already refuses to silently link/create in
 *     that specific case too - this function generalizes that same
 *     refusal to every case where no `Account` row exists yet, rather
 *     than auto-creating one).
 *
 * Never distinguishes "no Voltessa account with this email at all" from
 * "a Voltessa account exists but was never linked to Google" - both
 * collapse to the same generic `noLinkedAccount` result, exactly
 * mirroring `authenticateWithPassword`'s own "never confirm whether an
 * email exists" discipline. This function doesn't even look up by email
 * for the rejection path, so there is nothing email-shaped to leak.
 */

export type AuthenticateWithGoogleResult =
  | { ok: true; userId: string; email: string; accountType: string }
  | { ok: false; code: "invalidCredential" }
  | { ok: false; code: "noLinkedAccount" }
  | { ok: false; code: "accountInactive" };

export async function authenticateWithGoogle(idToken: string): Promise<AuthenticateWithGoogleResult> {
  const identity = await verifyGoogleIdToken(idToken);

  if (!identity) {
    return { ok: false, code: "invalidCredential" };
  }

  const account = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: "google",
        providerAccountId: identity.sub,
      },
    },
    select: {
      user: {
        select: {
          id: true,
          email: true,
          accountType: true,
          deletedAt: true,
          deactivatedAt: true,
        },
      },
    },
  });

  if (!account) {
    return { ok: false, code: "noLinkedAccount" };
  }

  const { user } = account;

  if (user.deletedAt || user.deactivatedAt) {
    return { ok: false, code: "accountInactive" };
  }

  return {
    ok: true,
    userId: user.id,
    email: user.email!,
    accountType: user.accountType,
  };
}
