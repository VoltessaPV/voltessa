import { prisma } from "@/lib/prisma";
import { getValidSungrowAccessToken } from "@/lib/isolarcloud/get-valid-access-token";

/**
 * Sungrow iSolarCloud OAuth2 Open API client. Mirrors
 * `lib/fusionsolar/api-client.ts`'s shape (typed envelope, thrown
 * `*ApiError`, request logging) but is NOT proxied through
 * `FUSIONSOLAR_GATEWAY_URL` — that gateway exists specifically to work
 * around Huawei's own IP allow-listing (ADR-004); nothing in the available
 * Sungrow documentation (portal-confirmed application capabilities:
 * Authorization, Refresh Token, Monitoring, Grid Control, Live Data)
 * indicates an equivalent IP-allowlist requirement, so this calls Sungrow's
 * regional gateway directly. Revisit if a real call ever comes back with an
 * IP-restriction-shaped error.
 *
 * Region: hardcoded to Europe (`gateway.isolarcloud.eu`) — the correct
 * region for a Bulgaria-based customer. Not sourced from Sungrow's own
 * official documentation (portal access is login-gated and could not be
 * reached during research) — derived from the third-party `pysolarcloud`
 * client's documented `Server` enum, cross-checked against the EU
 * authorization URL host (`web3.isolarcloud.eu`) actually configured for
 * the Voltessa application, which uses the same `.eu` regional suffix.
 * Treat every endpoint path/field name in this module family the same way:
 * best-available, not Sungrow-confirmed, until verified against the real
 * "API Document" inside the logged-in Developer Portal.
 */

const SUNGROW_GATEWAY_BASE_URL = "https://gateway.isolarcloud.eu";

export type SungrowConnection = {
  id: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
};

type SungrowApiResponse<T> = {
  result_code?: string;
  result_msg?: string;
  result_data?: T;
  req_serial_num?: string;
};

export class SungrowApiError extends Error {
  readonly httpStatus: number | null;
  readonly resultCode: string | null;
  readonly response: unknown;

  constructor(
    message: string,
    options: { httpStatus?: number | null; resultCode?: string | null; response?: unknown } = {},
  ) {
    super(message);
    this.name = "SungrowApiError";
    this.httpStatus = options.httpStatus ?? null;
    this.resultCode = options.resultCode ?? null;
    this.response = options.response ?? null;
  }
}

function getSungrowAppCredentials() {
  const appKey = process.env.SUNGROW_APP_KEY;
  const appSecret = process.env.SUNGROW_APP_SECRET;

  if (!appKey || !appSecret) {
    throw new Error("Sungrow OAuth environment variables are not configured");
  }

  return { appKey, appSecret };
}

/**
 * Platform Health & Operations Center precedent (`HuaweiRequestLog`) is not
 * mirrored here with a second dedicated table — this integration is new and
 * unproven in production; a request-log model is easy to add later once
 * there's real traffic to reason about, per "don't build for a hypothetical
 * future requirement." `console.error` only, matching the majority of
 * `lib/*` error paths already in this codebase (see `docs/BACKLOG.md`'s
 * "Known gaps" — `lib/logger.ts` is already inconsistently used here, this
 * doesn't newly regress anything).
 */
export async function callSungrowApi<T>(
  connection: SungrowConnection,
  path: string,
  params: Record<string, unknown>,
): Promise<T> {
  const { appKey, appSecret } = getSungrowAppCredentials();

  const url = new URL(path, SUNGROW_GATEWAY_BASE_URL).toString();

  const startedAt = Date.now();

  try {
    const tokenResult = await getValidSungrowAccessToken(connection);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-access-key": appSecret,
        Authorization: `Bearer ${tokenResult.accessToken}`,
      },
      body: JSON.stringify({
        ...params,
        appkey: appKey,
        lang: "_en_US",
      }),
      cache: "no-store",
    });

    const responseText = await response.text();

    let responseBody: SungrowApiResponse<T>;

    try {
      responseBody = JSON.parse(responseText) as SungrowApiResponse<T>;
    } catch {
      throw new SungrowApiError(
        `Sungrow API returned invalid JSON: HTTP ${response.status}`,
        { httpStatus: response.status, response: responseText },
      );
    }

    if (!response.ok || (responseBody.result_code && responseBody.result_code !== "1")) {
      throw new SungrowApiError(
        responseBody.result_msg ?? `Sungrow API request failed: HTTP ${response.status}`,
        {
          httpStatus: response.status,
          resultCode: responseBody.result_code ?? null,
          response: responseBody,
        },
      );
    }

    return responseBody.result_data as T;
  } catch (error) {
    console.error("[Sungrow API Client] Request failed", {
      path,
      durationMs: Date.now() - startedAt,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}

export async function findSungrowConnection(
  organizationId: string,
): Promise<SungrowConnection | null> {
  return prisma.sungrowConnection.findUnique({
    where: { organizationId },
    select: { id: true, accessToken: true, refreshToken: true, expiresAt: true },
  });
}
