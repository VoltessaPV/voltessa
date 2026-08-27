import { PrismaAdapter } from "@auth/prisma-adapter";
import { cookies } from "next/headers";

import { prisma } from "@/lib/prisma";

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * The one place a database-backed `Session` row is minted outside of
 * NextAuth's own Google OAuth flow. NextAuth v5's built-in Credentials
 * provider always encodes a JWT for the session cookie, regardless of this
 * app's `session: { strategy: "database" }` (verified directly against
 * `@auth/core`'s compiled source - the credentials callback branch calls
 * `jwt.encode(...)` unconditionally, never `adapter.createSession`) - using
 * it here would produce a cookie the rest of the app's database-strategy
 * `auth()`/`getSessionAndUser` calls can never read back. Email/password
 * sign-in therefore never goes through NextAuth's `signIn()` at all; this
 * function does exactly what NextAuth's own database-session flow does for
 * Google, so every login method - Google via NextAuth, password via this -
 * ends up as an identical row in the same `Session` table, revocable the
 * same way (delete the row).
 *
 * Cookie name/attributes and the 30-day default session length are Auth.js's
 * own documented conventions, verified directly against `@auth/core`'s
 * `defaultCookies()`/`index.js` rather than guessed - a mismatch here would
 * silently break every password login. `useSecureCookies` is derived from
 * `NODE_ENV` rather than the request's protocol (what Auth.js itself checks)
 * because this app's `AUTH_URL` is https in every real deployment; only
 * local dev is http, and `NODE_ENV` distinguishes that just as reliably here.
 */
export type DatabaseSessionResult = {
  sessionToken: string;
  expires: Date;
};

/**
 * Mobile Client Architecture milestone (ADR-020): now returns the minted
 * `sessionToken`/`expires` instead of `void`, so an approved caller can use
 * the same value as the Mobile Bearer presentation channel's credential.
 *
 * `options.setCookie` (M1 follow-up): defaults to `true`, so every existing
 * caller (`login/actions.ts`, `verify-email/confirm/route.ts`) — neither of
 * which passes `options` at all — keeps setting the Web cookie exactly as
 * before this parameter existed; this is still the one and only place a
 * database-backed `Session` row is minted outside NextAuth's own Google
 * flow, not a second implementation. Only the Mobile sign-in Route Handler
 * passes `{ setCookie: false }`, since a `Set-Cookie` header on a JSON API
 * response to a non-browser client is an unintended side effect, not part
 * of the Bearer presentation channel ADR-020 describes.
 */
export async function createDatabaseSession(
  userId: string,
  options?: { setCookie?: boolean },
): Promise<DatabaseSessionResult> {
  const adapter = PrismaAdapter(prisma);
  const sessionToken = crypto.randomUUID();
  const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  await adapter.createSession!({ sessionToken, userId, expires });

  if (options?.setCookie ?? true) {
    const cookieStore = await cookies();
    cookieStore.set(getAuthSessionCookieName(), sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      expires,
    });
  }

  return { sessionToken, expires };
}

/**
 * The exact NextAuth v5 database-session cookie name this app's requests
 * carry — verified against `@auth/core`'s `defaultCookies()`, see this
 * file's own doc comment above. Exported so `lib/auth/impersonation.ts` can
 * read the real admin's own session token off the request without
 * duplicating this derivation a second time.
 */
export function getAuthSessionCookieName(): string {
  const useSecureCookies = process.env.NODE_ENV === "production";
  return `${useSecureCookies ? "__Secure-" : ""}authjs.session-token`;
}
