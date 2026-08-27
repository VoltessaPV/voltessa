import { NextRequest, NextResponse } from "next/server";

import { revokeApiSession } from "@/lib/auth/api-session";

export const runtime = "nodejs";

/**
 * Mobile Client Architecture milestone (ADR-020), M1. Thin wrapper over
 * `revokeApiSession` (`lib/auth/api-session.ts`) - deletes exactly the one
 * `Session` row the caller's own Bearer token names, the same table/
 * mechanism Web's `signOutAction` already invalidates via NextAuth's
 * `signOut()`. Deliberately does not require `requireApiUser`/
 * `requireApiPermission` - sign-out must succeed for any bearer-presented
 * token regardless of onboarding status, and is idempotent (a missing or
 * already-invalid token still results in "not signed in", the same end
 * state as a successful sign-out).
 */
export async function POST(request: NextRequest) {
  await revokeApiSession(request);

  return NextResponse.json({ ok: true });
}
