import { prisma } from "@/lib/prisma";

/**
 * Mirrors `lib/fusionsolar/get-valid-access-token.ts`'s expiry-buffer +
 * refresh-and-persist shape exactly, including that file's own convention
 * of declaring a local connection type rather than importing one from
 * `api-client.ts` — this module is called BY `api-client.ts`'s
 * `callSungrowApi`, so importing back from there would be circular.
 * Endpoint/body shape is third-party-derived (`pysolarcloud`), not
 * confirmed against Sungrow's own documentation — see `api-client.ts`'s top
 * doc comment.
 */

type SungrowConnection = {
  id: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
};

const SUNGROW_GATEWAY_BASE_URL = "https://gateway.isolarcloud.eu";
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

type SungrowTokenResponse = {
  result_code?: string;
  result_msg?: string;
  result_data?: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
};

type GetValidAccessTokenResult = {
  accessToken: string;
  refreshed: boolean;
};

export async function getValidSungrowAccessToken(
  connection: SungrowConnection,
): Promise<GetValidAccessTokenResult> {
  const expiresAt = connection.expiresAt?.getTime();

  const tokenIsStillValid =
    typeof expiresAt === "number" && expiresAt > Date.now() + TOKEN_EXPIRY_BUFFER_MS;

  if (tokenIsStillValid) {
    return { accessToken: connection.accessToken, refreshed: false };
  }

  if (!connection.refreshToken) {
    throw new Error("Sungrow refresh token is missing");
  }

  const appKey = process.env.SUNGROW_APP_KEY;
  const appSecret = process.env.SUNGROW_APP_SECRET;

  if (!appKey || !appSecret) {
    throw new Error("Sungrow OAuth environment variables are not configured");
  }

  const response = await fetch(
    new URL("/openapi/apiManage/refreshToken", SUNGROW_GATEWAY_BASE_URL).toString(),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-access-key": appSecret,
      },
      body: JSON.stringify({
        appkey: appKey,
        refresh_token: connection.refreshToken,
      }),
      cache: "no-store",
    },
  );

  const responseText = await response.text();

  let tokenData: SungrowTokenResponse;

  try {
    tokenData = JSON.parse(responseText) as SungrowTokenResponse;
  } catch {
    throw new Error(`Sungrow refresh returned invalid JSON: HTTP ${response.status}`);
  }

  const accessToken = tokenData.result_data?.access_token;

  if (!response.ok || !accessToken) {
    throw new Error(
      tokenData.result_msg ?? `Sungrow token refresh failed: HTTP ${response.status}`,
    );
  }

  const refreshToken = tokenData.result_data?.refresh_token ?? connection.refreshToken;

  const expiresAtUpdated =
    typeof tokenData.result_data?.expires_in === "number"
      ? new Date(Date.now() + tokenData.result_data.expires_in * 1000)
      : null;

  await prisma.sungrowConnection.update({
    where: { id: connection.id },
    data: {
      accessToken,
      refreshToken,
      expiresAt: expiresAtUpdated,
    },
  });

  return { accessToken, refreshed: true };
}
