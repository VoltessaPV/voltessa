import { createHmac, timingSafeEqual } from "node:crypto";

const STATE_TTL_SECONDS = 10 * 60;

type OAuthStatePayload = {
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
  return createHmac("sha256", getStateSecret())
    .update(payload)
    .digest("base64url");
}

export function createFusionSolarOAuthState(input: {
  organizationId: string;
  userId: string;
}) {
  const payload: OAuthStatePayload = {
    organizationId: input.organizationId,
    userId: input.userId,
    expiresAt: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
    nonce: crypto.randomUUID(),
  };

  const encodedPayload = Buffer.from(
    JSON.stringify(payload),
  ).toString("base64url");

  const signature = signPayload(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function verifyFusionSolarOAuthState(
  state: string,
): OAuthStatePayload | null {
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
    ) as OAuthStatePayload;

    if (
      !payload.organizationId ||
      !payload.userId ||
      !payload.expiresAt ||
      !payload.nonce
    ) {
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