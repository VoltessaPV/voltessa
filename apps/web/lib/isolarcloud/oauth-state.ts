import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Sungrow's own CSRF state generate/verify — HMAC-signed, timing-safe,
 * short-lived, same mechanism as `lib/fusionsolar/oauth-state.ts` (which
 * exists but is dormant: Huawei's own `connect/route.ts` imports it
 * commented-out and never sets a `state` param; Huawei's callback never
 * calls its verify function either). This is a separate, Sungrow-owned
 * copy rather than an import from that file — same reasoning as
 * `SungrowConnection` being its own model rather than reusing
 * `FusionSolarConnection`: no cross-vendor coupling, and zero risk of
 * touching a file that sits next to Huawei's live OAuth code.
 *
 * Actually wired into Sungrow's flow (unlike Huawei's dormant copy) —
 * see `app/api/auth/isolarcloud/connect/route.ts` and `callback/route.ts`.
 *
 * Known open question, not resolved by this code: Sungrow's authorization
 * URL is a Developer-Portal SPA route (`#/authorized-app?...`), not a
 * classic `/oauth2/authorize` endpoint, and third-party research (never
 * officially confirmed) suggests Sungrow may not echo a `state` param back
 * on redirect at all. The callback therefore verifies `state` when present
 * and rejects an invalid one, but does not hard-fail when it's simply
 * absent — see that file's own comment.
 */

const STATE_TTL_SECONDS = 10 * 60;

type SungrowOAuthStatePayload = {
  organizationId: string;
  userId: string;
  expiresAt: number;
  nonce: string;
};

function getStateSecret() {
  const secret = process.env.AUTH_SECRET;

  if (!secret) {
    throw new Error("AUTH_SECRET is not configured");
  }

  return secret;
}

function signPayload(payload: string) {
  return createHmac("sha256", getStateSecret()).update(payload).digest("base64url");
}

export function createSungrowOAuthState(input: { organizationId: string; userId: string }): string {
  const payload: SungrowOAuthStatePayload = {
    organizationId: input.organizationId,
    userId: input.userId,
    expiresAt: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
    nonce: crypto.randomUUID(),
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signPayload(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function verifySungrowOAuthState(state: string): SungrowOAuthStatePayload | null {
  const [encodedPayload, signature] = state.split(".");

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signPayload(encodedPayload);

  const signatureBuffer = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);

  if (signatureBuffer.length !== expectedSignatureBuffer.length) {
    return null;
  }

  if (!timingSafeEqual(signatureBuffer, expectedSignatureBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as SungrowOAuthStatePayload;

    if (!payload.organizationId || !payload.userId || !payload.expiresAt || !payload.nonce) {
      return null;
    }

    if (payload.expiresAt < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
