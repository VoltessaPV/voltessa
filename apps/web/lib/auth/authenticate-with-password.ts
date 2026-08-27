import { verifyPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/prisma";

/**
 * Mobile Client Architecture milestone (ADR-020), M1. Extracted, verbatim,
 * from `app/[locale]/login/actions.ts`'s `signInWithPassword` — the exact
 * same lookup/verification/status checks, now callable from both the
 * existing Web Server Action (unchanged behavior) and the new Mobile
 * sign-in Route Handler, per ADR-020's "Feature parity" rule: business
 * logic is written once, as a plain function taking explicit inputs, never
 * reading cookies/session/`redirect()` internally.
 *
 * Deliberately returns a result, never redirects or sets a session itself —
 * the caller (Web Server Action or Mobile Route Handler) decides what to do
 * with a successful result (create a cookie session vs. create a Bearer
 * session token), exactly as ADR-020 requires.
 */

export type AuthenticateWithPasswordResult =
  | { ok: true; userId: string; email: string; accountType: string }
  | { ok: false; code: "invalidCredentials" }
  | { ok: false; code: "emailNotVerified"; email: string }
  | { ok: false; code: "accountInactive" };

/**
 * Never distinguishes "no such account", "account has no password" (a
 * Google-only account), or "wrong password" - a single generic
 * `invalidCredentials` result for all three, exactly as the Web path
 * already did before this extraction. `emailVerified` is checked only
 * AFTER the password is confirmed correct, for the same reason the
 * original inline version did: an attacker can't use this to enumerate
 * registered-but-unverified emails without already knowing the password.
 */
export async function authenticateWithPassword(
  email: string,
  password: string,
): Promise<AuthenticateWithPasswordResult> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      emailVerified: true,
      deletedAt: true,
      deactivatedAt: true,
      accountType: true,
    },
  });

  const passwordValid = user?.passwordHash
    ? await verifyPassword(password, user.passwordHash)
    : false;

  if (!user || !passwordValid) {
    return { ok: false, code: "invalidCredentials" };
  }

  if (!user.emailVerified) {
    return { ok: false, code: "emailNotVerified", email: user.email! };
  }

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
