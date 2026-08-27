import { NextRequest, NextResponse } from "next/server";

import { authenticateWithPassword } from "@/lib/auth/authenticate-with-password";
import { createDatabaseSession } from "@/lib/auth/create-session";
import { findCurrentUserById } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * Mobile Client Architecture milestone (ADR-020), M1 — the sign-in
 * exchange path ADR-020 named as the minimum a mobile client needs but M0
 * never built (M0 shipped the Bearer resolver and read-only data
 * endpoints, and extended `createDatabaseSession` to return a token, but no
 * caller-facing route ever handed that token to anything). Without this,
 * every M0 endpoint is unreachable by a real client.
 *
 * Reuses `authenticateWithPassword` (the exact credential-check logic
 * `login/actions.ts`'s `signInWithPassword` uses) and `createDatabaseSession`
 * (unchanged, already mints the same `Session` row Web's password login
 * creates) - no parallel authentication mechanism, per ADR-020's explicit
 * requirement.
 *
 * Unlike the Web Server Action, this can't `redirect()` on an unverified
 * email - it returns a machine-readable `email_not_verified` code instead,
 * the mobile-appropriate equivalent of the same business decision, not a
 * different one.
 *
 * Never logs or echoes the submitted password, and the response's
 * `sessionToken` is the one place this credential is ever meant to leave
 * the server - see ADR-020's Security considerations.
 */
export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { email, password } = (body ?? {}) as { email?: unknown; password?: unknown };

  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await authenticateWithPassword(email, password);

  if (!result.ok) {
    if (result.code === "emailNotVerified") {
      return NextResponse.json({ error: "email_not_verified" }, { status: 403 });
    }

    if (result.code === "accountInactive") {
      return NextResponse.json({ error: "account_inactive" }, { status: 403 });
    }

    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  // Resolved before minting a session: matches every other Bearer-gated
  // endpoint's `requireApiUser` organization/onboarding gate (api-session.ts)
  // - a user who wouldn't be allowed to call any other Mobile endpoint
  // shouldn't be handed a token for one either, and checking first avoids
  // minting an orphaned Session row that would never actually be used.
  const user = await findCurrentUserById(result.userId);

  if (!user || !user.organizationId || !user.organization?.onboardingCompletedAt) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // `setCookie: false` - this is a JSON API response to a non-browser
  // client, not a page navigation; the token is returned in the body only
  // (see ADR-020's Bearer presentation channel), never also as a cookie.
  const { sessionToken, expires } = await createDatabaseSession(result.userId, {
    setCookie: false,
  });

  return NextResponse.json({
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
  });
}
