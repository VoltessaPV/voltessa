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

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

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

  const tokenResponse = await fetch(FUSIONSOLAR_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });

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
