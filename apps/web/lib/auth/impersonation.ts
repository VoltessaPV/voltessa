import { cookies } from "next/headers";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * Multi-Tenant Audit + Impersonation milestone (ADR-014's `ImpersonationSession`
 * model, previously schema-only). Deliberately holds only cookie plumbing and
 * a pure, read-only validator — never an authorization decision of its own.
 * `getCurrentUser()` (`lib/auth/session.ts`) is the only caller that turns
 * this into an actual identity override, and `app/admin/actions.ts`'s
 * `startImpersonation`/`stopImpersonation` are the only writers of the
 * underlying `ImpersonationSession` row — both already gate on
 * `requirePlatformAdmin()` before touching this module, so nothing here
 * needs to repeat that check.
 */

const IMPERSONATION_COOKIE_NAME = "voltessa-impersonation";
const useSecureCookies = process.env.NODE_ENV === "production";

export async function readImpersonationToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(IMPERSONATION_COOKIE_NAME)?.value ?? null;
}

/**
 * No explicit `expires`/`maxAge` — a session cookie, deliberately. Matches
 * `ImpersonationSession`'s own doc comment ("ends via explicit stop, admin
 * logout, or the admin's own session expiring"): closing the browser ends it
 * too, with nothing here to separately expire.
 */
export async function setImpersonationCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(IMPERSONATION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: useSecureCookies,
  });
}

export async function clearImpersonationCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(IMPERSONATION_COOKIE_NAME);
}

export type ActiveImpersonation = {
  adminUserId: string;
  targetUserId: string;
  targetName: string | null;
  targetEmail: string | null;
};

/**
 * The single source of truth for "is impersonation active right now, and
 * for whom" — `getCurrentUser()` uses this to decide whose identity to
 * return, and the platform layout's banner uses the exact same result to
 * decide whether to render (never two independent checks that could drift).
 *
 * Validates against the REAL, un-overridden session (`auth()` — never
 * `getCurrentUser()`, which would already be impersonation-aware and thus
 * circular) rather than re-deriving anything from the impersonation cookie
 * itself: the `ImpersonationSession` row's own `admin` relation must match
 * whoever `auth()` says is actually signed in on this browser right now. This
 * is what makes impersonation end the moment the admin's real session does
 * (sign-out, expiry, revocation) — no separate expiry bookkeeping needed
 * here, and no way for the cookie to outlive the session it was bound to.
 */
export async function resolveActiveImpersonation(): Promise<ActiveImpersonation | null> {
  const token = await readImpersonationToken();
  if (!token) {
    return null;
  }

  const session = await auth();
  if (!session?.user?.email) {
    return null;
  }

  const record = await prisma.impersonationSession.findUnique({
    where: { token },
    select: {
      endedAt: true,
      targetUserId: true,
      admin: { select: { id: true, email: true } },
      target: { select: { name: true, email: true } },
    },
  });

  if (!record || record.endedAt || record.admin.email !== session.user.email) {
    return null;
  }

  return {
    adminUserId: record.admin.id,
    targetUserId: record.targetUserId,
    targetName: record.target.name,
    targetEmail: record.target.email,
  };
}
