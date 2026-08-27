import { PrismaAdapter } from "@auth/prisma-adapter";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { findCurrentUserById, type CurrentUser, type CurrentUserWithOrganization } from "@/lib/auth/session";
import type { Role } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";

/**
 * Mobile Client Architecture milestone (ADR-020). Route-Handler-compatible
 * counterpart to `lib/auth/session.ts`'s `requireCurrentUser`/
 * `requireOnboardedUser`/`requirePermission` — same underlying `Session`
 * table, same `CurrentUser` resolution (`findCurrentUserById`, reused
 * verbatim, not reimplemented), same `Permissions.can*`/`Roles` model.
 * The only thing genuinely new here is *how* the credential arrives
 * (`Authorization: Bearer <sessionToken>` instead of a cookie) and *how* a
 * failure is reported (a typed `NextResponse`, since `redirect()`/
 * `forbidden()` are Server-Component/Action-only primitives that don't work
 * in a Route Handler — see ADR-006's own "Consequences" section, which
 * already named this exact gap).
 *
 * Existing cookie-based Web session resolution
 * (`getCurrentUser`/`requireCurrentUser`/`requireOnboardedUser`/
 * `requirePermission` in `lib/auth/session.ts`) is completely untouched by
 * this file — it is a new, parallel entry point, not a replacement.
 *
 * Never logs, and never includes in any response, the raw bearer token
 * value — every failure path below returns a generic, credential-free JSON
 * body.
 */

export type ApiAuthFailure = { ok: false; response: NextResponse };
export type ApiAuthSuccess<T> = { ok: true; user: T };
export type ApiAuthResult<T> = ApiAuthSuccess<T> | ApiAuthFailure;

function unauthorized(): ApiAuthFailure {
  return {
    ok: false,
    response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
  };
}

function forbiddenResult(): ApiAuthFailure {
  return {
    ok: false,
    response: NextResponse.json({ error: "forbidden" }, { status: 403 }),
  };
}

/** Never logs the extracted value — the caller only ever gets it back to hand to the adapter lookup below. */
function extractBearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization");

  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(" ");

  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

/**
 * Resolves the Bearer-presented credential to a `CurrentUser` — enforces
 * the exact same `Session.expires` semantics `@auth/core`'s own
 * database-session strategy documents (an accessed-past-expiry session is
 * deleted, not just treated as absent), via the same `@auth/prisma-adapter`
 * `getSessionAndUser`/`deleteSession` methods `auth()` itself uses
 * internally for the cookie path — not a hand-rolled re-implementation of
 * session-expiry logic.
 */
async function resolveApiUser(request: NextRequest): Promise<CurrentUser | null> {
  const token = extractBearerToken(request);

  if (!token) {
    return null;
  }

  const adapter = PrismaAdapter(prisma);
  const result = await adapter.getSessionAndUser!(token);

  if (!result) {
    return null;
  }

  if (result.session.expires.getTime() <= Date.now()) {
    await adapter.deleteSession!(token);
    return null;
  }

  return findCurrentUserById(result.user.id);
}

/**
 * Route-Handler equivalent of `requireOnboardedUser()` — same onboarding
 * check (`organizationId` + `organization.onboardingCompletedAt`), but
 * returns a typed 401/403 instead of calling `redirect()`.
 */
export async function requireApiUser(
  request: NextRequest,
): Promise<ApiAuthResult<CurrentUserWithOrganization>> {
  const user = await resolveApiUser(request);

  if (!user) {
    return unauthorized();
  }

  if (!user.organizationId || !user.organization?.onboardingCompletedAt) {
    return forbiddenResult();
  }

  return {
    ok: true,
    user: {
      ...user,
      organizationId: user.organizationId,
      organization: user.organization,
    },
  };
}

/**
 * Route-Handler equivalent of `requirePermission()` — same
 * `Permissions.can*` role check, but returns a typed 403 instead of calling
 * `forbidden()`.
 */
export async function requireApiPermission(
  request: NextRequest,
  allowedRoles: readonly Role[],
): Promise<ApiAuthResult<CurrentUserWithOrganization>> {
  const result = await requireApiUser(request);

  if (!result.ok) {
    return result;
  }

  if (!allowedRoles.includes(result.user.role)) {
    return forbiddenResult();
  }

  return result;
}

/**
 * M1 (ADR-020). Revokes exactly the one `Session` row the caller's own
 * Bearer credential names — the mobile sign-out counterpart to
 * `resolveApiUser`'s expiry-driven `deleteSession` call above, same
 * adapter method, same table. Idempotent and deliberately tolerant: a
 * missing/already-invalid token still means "no valid session for this
 * token" either way, so this never distinguishes that from "revoked
 * successfully" to the caller — there is nothing sensitive to protect by
 * failing loudly here, and doing so would require re-deriving whether the
 * token was well-formed just to decide how to respond.
 */
export async function revokeApiSession(request: NextRequest): Promise<void> {
  const token = extractBearerToken(request);

  if (!token) {
    return;
  }

  const adapter = PrismaAdapter(prisma);

  try {
    await adapter.deleteSession!(token);
  } catch (error) {
    // The adapter's deleteSession is a bare Prisma `delete` - it throws
    // P2025 ("record not found") if the row is already gone
    // (expired-and-cleaned-up, already signed out elsewhere, or simply
    // garbage). That specific end state ("no valid session for this
    // token") is identical to a successful revocation from the caller's
    // point of view, so only P2025 is swallowed here. Any other error
    // (a genuine database failure, connectivity issue, etc.) is a real
    // problem the caller must not be told succeeded - rethrown rather
    // than silently reported as `{ ok: true }`.
    const isSessionAlreadyGone =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";

    if (!isSessionAlreadyGone) {
      throw error;
    }
  }
}
