import { NextRequest, NextResponse } from "next/server";

import { authenticateWithGoogle } from "@/lib/auth/authenticate-with-google";
import { mintMobileSessionForUser } from "@/lib/auth/mint-mobile-session";

export const runtime = "nodejs";

/**
 * Mobile Client Architecture (ADR-020), M5. The Google counterpart to
 * `sign-in/route.ts` - same response contract (`sessionToken`/`expires`/
 * `user`), same `mintMobileSessionForUser` tail, so the Android client's
 * handling of a successful response is identical regardless of which
 * credential the user signed in with.
 *
 * The Android app obtains `idToken` via Android's own Credential Manager
 * / Sign in with Google (never a manual WebView OAuth flow) and sends
 * only that token here - never a client secret, since Android OAuth
 * clients have none and this route never uses `AUTH_GOOGLE_SECRET`
 * either (see `verify-google-id-token.ts`).
 *
 * Only ever signs in an already-linked Voltessa account - see
 * `authenticate-with-google.ts`'s own doc comment for exactly why this is
 * deliberately narrower than Web's own Google sign-in (which auto-creates
 * a new user on first use).
 */
export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { idToken } = (body ?? {}) as { idToken?: unknown };

  if (typeof idToken !== "string" || !idToken) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await authenticateWithGoogle(idToken);

  if (!result.ok) {
    if (result.code === "accountInactive") {
      return NextResponse.json({ error: "account_inactive" }, { status: 403 });
    }

    if (result.code === "noLinkedAccount") {
      return NextResponse.json({ error: "no_linked_account" }, { status: 401 });
    }

    return NextResponse.json({ error: "invalid_credential" }, { status: 401 });
  }

  const session = await mintMobileSessionForUser(result.userId);

  if (!session.ok) {
    return NextResponse.json({ error: "forbidden" }, { status: session.status });
  }

  return NextResponse.json({
    sessionToken: session.sessionToken,
    expires: session.expires,
    user: session.user,
  });
}
