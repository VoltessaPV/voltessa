import { NextRequest, NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth/api-session";

export const runtime = "nodejs";

/**
 * Mobile Client Architecture milestone (ADR-020) — the first of the small,
 * unversioned Route Handlers proving the client boundary. Reuses
 * `requireApiUser` (which itself reuses `findCurrentUserById`, the same
 * function `getCurrentUser()` uses for the Web/cookie path) — no new
 * identity resolution logic, no vendor concept anywhere in this file.
 */
export async function GET(request: NextRequest) {
  const auth = await requireApiUser(request);

  if (!auth.ok) {
    return auth.response;
  }

  const { user } = auth;

  return NextResponse.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    organization: { id: user.organization.id, name: user.organization.name },
  });
}
