import { createDatabaseSession } from "@/lib/auth/create-session";
import { findCurrentUserById } from "@/lib/auth/session";

/**
 * Mobile Client Architecture (ADR-020). Shared tail of every Mobile
 * sign-in exchange, regardless of which credential proved the caller's
 * identity (password, Google ID token, ...): resolve the user, enforce
 * the same organization/onboarding gate every other Bearer-gated endpoint
 * enforces (`api-session.ts`'s `requireApiUser`), then mint a Bearer
 * session token. Extracted out of `sign-in/route.ts` so a second
 * authentication method (Google, M5) doesn't duplicate this logic - one
 * canonical "turn a verified userId into a mobile session" function.
 */
export type MintMobileSessionResult =
  | {
      ok: true;
      sessionToken: string;
      expires: string;
      user: {
        id: string;
        name: string | null;
        email: string;
        role: string;
        organizationId: string;
        organization: { id: string; name: string };
      };
    }
  | { ok: false; status: 403 };

export async function mintMobileSessionForUser(userId: string): Promise<MintMobileSessionResult> {
  // Resolved before minting a session: matches every other Bearer-gated
  // endpoint's `requireApiUser` organization/onboarding gate - a user who
  // wouldn't be allowed to call any other Mobile endpoint shouldn't be
  // handed a token for one either, and checking first avoids minting an
  // orphaned Session row that would never actually be used.
  const user = await findCurrentUserById(userId);

  if (!user || !user.organizationId || !user.organization?.onboardingCompletedAt) {
    return { ok: false, status: 403 };
  }

  // `setCookie: false` - this is a JSON API response to a non-browser
  // client, not a page navigation; the token is returned in the body only
  // (see ADR-020's Bearer presentation channel), never also as a cookie.
  const { sessionToken, expires } = await createDatabaseSession(userId, { setCookie: false });

  return {
    ok: true,
    sessionToken,
    expires: expires.toISOString(),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      organization: { id: user.organization.id, name: user.organization.name },
    },
  };
}
