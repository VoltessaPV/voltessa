import { prisma } from "@/lib/prisma";

export const FUSIONSOLAR_TOKEN_URL =
  "https://oauth2.fusionsolar.huawei.com/rest/dp/uidm/oauth2/v1/token";

type FusionSolarTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type FusionSolarConnection = {
  id: string;
  accessToken: string;
  refreshToken: string | null;
  tokenType: string | null;
  scope: string | null;
  expiresAt: Date | null;
};

type GetValidAccessTokenResult = {
  accessToken: string;
  refreshed: boolean;
};

type FetchErrorCause = {
  code?: string;
  hostname?: string;
  message?: string;
};

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

const NETWORK_RETRY_DELAYS_MS = [250, 500];

const RETRYABLE_NETWORK_ERROR_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "EBUSY",
  "ECONNRESET",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function getFetchErrorCause(error: unknown): FetchErrorCause | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  return error.cause as FetchErrorCause | undefined;
}

function isRetryableNetworkError(error: unknown) {
  const cause = getFetchErrorCause(error);

  return Boolean(
    cause?.code &&
      RETRYABLE_NETWORK_ERROR_CODES.has(cause.code),
  );
}

async function fetchFusionSolarToken(
  body: URLSearchParams,
): Promise<Response> {
  const maximumAttempts = NETWORK_RETRY_DELAYS_MS.length + 1;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await fetch(FUSIONSOLAR_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
        cache: "no-store",
      });
    } catch (error) {
      const cause = getFetchErrorCause(error);
      const retryable = isRetryableNetworkError(error);
      const hasAnotherAttempt = attempt < maximumAttempts;

      console.error("[FusionSolar Token Refresh] Fetch failed", {
        attempt,
        maximumAttempts,
        retryable,
        errorName:
          error instanceof Error ? error.name : "UnknownError",
        errorMessage:
          error instanceof Error ? error.message : String(error),
        causeCode: cause?.code,
        causeHostname: cause?.hostname,
        causeMessage: cause?.message,
      });

      if (!retryable || !hasAnotherAttempt) {
        throw new Error(
          [
            "FusionSolar refresh fetch failed",
            cause?.code,
            cause?.hostname,
            cause?.message,
          ]
            .filter(Boolean)
            .join(": "),
        );
      }

    const retryDelay =
    NETWORK_RETRY_DELAYS_MS[attempt - 1];

    if (retryDelay === undefined) {
    throw new Error(
        "FusionSolar retry delay configuration is invalid",
    );
    }

    await sleep(retryDelay);
    }
  }

  throw new Error("FusionSolar refresh fetch failed unexpectedly");
}

export async function getValidFusionSolarAccessToken(
  connection: FusionSolarConnection,
): Promise<GetValidAccessTokenResult> {
  const expiresAt = connection.expiresAt?.getTime();

  const tokenIsStillValid =
    typeof expiresAt === "number" &&
    expiresAt > Date.now() + TOKEN_EXPIRY_BUFFER_MS;

  if (tokenIsStillValid) {
    return {
      accessToken: connection.accessToken,
      refreshed: false,
    };
  }

  if (!connection.refreshToken) {
    throw new Error("FusionSolar refresh token is missing");
  }

  const clientId = process.env.FUSIONSOLAR_CLIENT_ID;
  const clientSecret = process.env.FUSIONSOLAR_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "FusionSolar OAuth environment variables are not configured",
    );
  }

  const body = new URLSearchParams();

  body.set("grant_type", "refresh_token");
  body.set("refresh_token", connection.refreshToken);
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);

  const tokenResponse = await fetchFusionSolarToken(body);

  const responseText = await tokenResponse.text();

  let tokenData: FusionSolarTokenResponse;

  try {
    tokenData = JSON.parse(responseText) as FusionSolarTokenResponse;
  } catch {
    throw new Error(
      `FusionSolar refresh returned invalid JSON: HTTP ${tokenResponse.status}`,
    );
  }

  if (!tokenResponse.ok || !tokenData.access_token) {
    throw new Error(
      tokenData.error_description ??
        tokenData.error ??
        `FusionSolar token refresh failed: HTTP ${tokenResponse.status}`,
    );
  }

  const refreshToken =
    tokenData.refresh_token ?? connection.refreshToken;

  const expiresAtUpdated =
    typeof tokenData.expires_in === "number"
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : null;

  await prisma.fusionSolarConnection.update({
    where: {
      id: connection.id,
    },
    data: {
      accessToken: tokenData.access_token,
      refreshToken,
      tokenType: tokenData.token_type ?? connection.tokenType,
      scope: tokenData.scope ?? connection.scope,
      expiresAt: expiresAtUpdated,
    },
  });

  return {
    accessToken: tokenData.access_token,
    refreshed: true,
  };
}
