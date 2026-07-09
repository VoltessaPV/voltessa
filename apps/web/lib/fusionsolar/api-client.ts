import { getValidFusionSolarAccessToken } from "@/lib/fusionsolar/get-valid-access-token";

export type FusionSolarConnection = {
  id: string;
  accessToken: string;
  refreshToken: string | null;
  tokenType: string | null;
  scope: string | null;
  expiresAt: Date | null;
};

type FusionSolarApiResponse<T> = {
  success?: boolean;
  data?: T;
  failCode?: number;
  message?: string | null;
  params?: unknown;
};

type FusionSolarApiRequest = {
  path: string;
  body: Record<string, unknown>;
};

export class FusionSolarApiError extends Error {
  readonly httpStatus: number | null;
  readonly failCode: number | null;
  readonly response: unknown;

  constructor(
    message: string,
    options: {
      httpStatus?: number | null;
      failCode?: number | null;
      response?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "FusionSolarApiError";
    this.httpStatus = options.httpStatus ?? null;
    this.failCode = options.failCode ?? null;
    this.response = options.response ?? null;
  }
}

function getGatewayConfiguration() {
  const gatewayUrl = process.env.FUSIONSOLAR_GATEWAY_URL;
  const gatewaySecret =
    process.env.FUSIONSOLAR_GATEWAY_SECRET;

  if (!gatewayUrl || !gatewaySecret) {
    throw new Error(
      "FusionSolar gateway environment variables are not configured",
    );
  }

  return {
    apiUrl: new URL(
      "/v1/fusionsolar/api",
      gatewayUrl,
    ).toString(),
    gatewaySecret,
  };
}

export async function callFusionSolarApi<T>(
  connection: FusionSolarConnection,
  request: FusionSolarApiRequest,
): Promise<{
  data: T;
  tokenRefreshed: boolean;
}> {
  const { apiUrl, gatewaySecret } =
    getGatewayConfiguration();

  const tokenResult =
    await getValidFusionSolarAccessToken(connection);

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenResult.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, */*",
      "x-gateway-secret": gatewaySecret,
    },
    body: JSON.stringify({
      path: request.path,
      body: request.body,
    }),
    cache: "no-store",
    redirect: "manual",
  });

  const responseText = await response.text();

  let responseBody: FusionSolarApiResponse<T>;

  try {
    responseBody = JSON.parse(
      responseText,
    ) as FusionSolarApiResponse<T>;
  } catch {
    throw new FusionSolarApiError(
      `FusionSolar gateway returned invalid JSON: HTTP ${response.status}`,
      {
        httpStatus: response.status,
        response: responseText,
      },
    );
  }

  if (!response.ok) {
    throw new FusionSolarApiError(
      `FusionSolar gateway request failed: HTTP ${response.status}`,
      {
        httpStatus: response.status,
        failCode: responseBody.failCode,
        response: responseBody,
      },
    );
  }

  if (responseBody.success !== true) {
    throw new FusionSolarApiError(
      responseBody.message ??
        `FusionSolar API request failed with failCode ${responseBody.failCode ?? "unknown"}`,
      {
        httpStatus: response.status,
        failCode: responseBody.failCode,
        response: responseBody,
      },
    );
  }

  return {
    data: responseBody.data as T,
    tokenRefreshed: tokenResult.refreshed,
  };
}
