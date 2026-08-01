import { getValidFusionSolarAccessToken } from "@/lib/fusionsolar/get-valid-access-token";
import { prisma } from "@/lib/prisma";

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
  readonly headers: Record<string, string> | null;

  constructor(
    message: string,
    options: {
      httpStatus?: number | null;
      failCode?: number | null;
      response?: unknown;
      headers?: Record<string, string> | null;
    } = {},
  ) {
    super(message);
    this.name = "FusionSolarApiError";
    this.httpStatus = options.httpStatus ?? null;
    this.failCode = options.failCode ?? null;
    this.response = options.response ?? null;
    this.headers = options.headers ?? null;
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

/**
 * Platform Health & Operations Center milestone (Section 2, Huawei health).
 * Best-effort: a logging failure must never break the real Huawei call this
 * describes, so failures here are swallowed and reported to `console.error`
 * only — the same discipline `synchronizeFusionSolarConnection` already
 * applies to its own Huawei/network failures.
 */
async function logHuaweiRequest(entry: {
  connectionId: string;
  apiPath: string;
  httpStatus: number | null;
  success: boolean;
  failCode: number | null;
  errorName: string | null;
  errorMessage: string | null;
  durationMs: number;
  tokenRefreshed: boolean;
}): Promise<void> {
  try {
    await prisma.huaweiRequestLog.create({ data: entry });
  } catch (error) {
    console.error("[FusionSolar API Client] Failed to persist HuaweiRequestLog", error);
  }
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

  const startedAt = Date.now();
  let httpStatus: number | null = null;
  let failCode: number | null = null;
  let errorName: string | null = null;
  let errorMessage: string | null = null;
  let success = false;

  try {
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

    httpStatus = response.status;

    const responseText = await response.text();

    const responseHeaders = Object.fromEntries(
      response.headers.entries(),
    );

    let responseBody: FusionSolarApiResponse<T>;

    try {
      responseBody = JSON.parse(
        responseText,
      ) as FusionSolarApiResponse<T>;
    } catch {
      errorMessage = `FusionSolar gateway returned invalid JSON: HTTP ${response.status}`;
      throw new FusionSolarApiError(errorMessage, {
        httpStatus: response.status,
        response: responseText,
        headers: responseHeaders,
      });
    }

    failCode = responseBody.failCode ?? null;

    if (!response.ok) {
      errorMessage = `FusionSolar gateway request failed: HTTP ${response.status}`;
      throw new FusionSolarApiError(errorMessage, {
        httpStatus: response.status,
        failCode: responseBody.failCode,
        response: responseBody,
        headers: responseHeaders,
      });
    }

    if (responseBody.success !== true) {
      errorMessage =
        responseBody.message ??
        `FusionSolar API request failed with failCode ${responseBody.failCode ?? "unknown"}`;
      throw new FusionSolarApiError(errorMessage, {
        httpStatus: response.status,
        failCode: responseBody.failCode,
        response: responseBody,
        headers: responseHeaders,
      });
    }

    success = true;

    return {
      data: responseBody.data as T,
      tokenRefreshed: tokenResult.refreshed,
    };
  } catch (error) {
    if (error instanceof FusionSolarApiError) {
      httpStatus = error.httpStatus;
      failCode = error.failCode;
      errorMessage = errorMessage ?? error.message;
    } else if (error instanceof Error) {
      // The fetch itself failed before any HTTP response was received
      // (network failure, DNS, abort) — httpStatus stays null, distinct
      // from a real HTTP error response.
      errorName = error.name;
      errorMessage = error.message;
    }

    throw error;
  } finally {
    await logHuaweiRequest({
      connectionId: connection.id,
      apiPath: request.path,
      httpStatus,
      success,
      failCode,
      errorName,
      errorMessage,
      durationMs: Date.now() - startedAt,
      tokenRefreshed: tokenResult.refreshed,
    });
  }
}
