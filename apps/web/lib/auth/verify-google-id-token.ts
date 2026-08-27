/**
 * Mobile Client Architecture (ADR-020), M5. Verifies a Google ID token
 * obtained by the Android app via Credential Manager / Sign in with
 * Google (never a manually-implemented OAuth flow) - the Android client
 * only ever hands the server this token, never a client secret (Android
 * OAuth clients have none), and the server here never uses
 * `AUTH_GOOGLE_SECRET` either - only `AUTH_GOOGLE_ID` (a public,
 * non-secret client identifier, already used unchanged by Web's own
 * Google provider config in `lib/auth/config.ts`) to check the token's
 * audience.
 *
 * Uses Google's `tokeninfo` endpoint (a single, simple, unauthenticated
 * verification call) rather than adding a JWKS-verification dependency -
 * consistent with this codebase's existing pattern of a plain `fetch`
 * against a third-party API for external verification (see
 * `lib/weather/openMeteo.ts`, `lib/market-price/providers/entsoe.ts`).
 * Google documents this endpoint as a valid way to validate an ID token;
 * it is not recommended for very high request volumes, which does not
 * apply to Voltessa's current scale.
 */

const GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

export type VerifiedGoogleIdentity = {
  /** Google's stable per-account identifier - `Account.providerAccountId` for provider "google". */
  sub: string;
  email: string;
  name: string | null;
};

export async function verifyGoogleIdToken(idToken: string): Promise<VerifiedGoogleIdentity | null> {
  const url = new URL(GOOGLE_TOKENINFO_URL);
  url.searchParams.set("id_token", idToken);

  let response: Response;

  try {
    response = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!payload) {
    return null;
  }

  const aud = payload.aud;
  const iss = payload.iss;
  const emailVerified = payload.email_verified;
  const email = payload.email;
  const sub = payload.sub;

  if (
    typeof aud !== "string" ||
    aud !== process.env.AUTH_GOOGLE_ID ||
    typeof iss !== "string" ||
    !GOOGLE_ISSUERS.has(iss) ||
    emailVerified !== "true" ||
    typeof email !== "string" ||
    typeof sub !== "string"
  ) {
    return null;
  }

  const name = typeof payload.name === "string" ? payload.name : null;

  return { sub, email, name };
}
