import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { verifySungrowOAuthState } from "@/lib/isolarcloud/oauth-state";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * Mirrors `app/api/auth/fusionsolar/callback/route.ts`'s shape (session
 * check, org check, env-configured secrets, token exchange, connection
 * upsert) with one deliberate difference: it does NOT auto-sync/auto-create
 * any `Plant` rows here. Huawei's callback can safely upsert every
 * discovered station immediately because Huawei plants are 1:1 with the
 * organization's FusionSolar account in this codebase's existing usage.
 * Sungrow's brief explicitly requires a plant-picker step ("customer
 * authorizes -> discover plants -> user selects a plant -> create/associate
 * the Voltessa Plant record") — so this route only stores the token and
 * hands off to `/plants/connect/isolarcloud`, which does the discovery +
 * picker + `Plant` creation (see that page's server action).
 *
 * Token endpoint/body shape is third-party-derived (`pysolarcloud`), not
 * confirmed against Sungrow's own documentation — see
 * `lib/isolarcloud/api-client.ts`'s top doc comment.
 *
 * `state` handling (Phase 1 authentication milestone): verified when
 * present (reject the whole flow on a bad signature/expiry/organization
 * mismatch — a real CSRF signal worth failing hard on), but NOT required
 * to be present. Sungrow's authorization URL is a Developer-Portal SPA
 * route, not a classic `/oauth2/authorize` endpoint, and it is not
 * confirmed (only suggested by third-party research) that Sungrow echoes
 * a `state` param back on redirect at all. Falling back to session-only
 * validation when `state` is simply absent matches the security floor
 * Huawei's own flow already has today (its own state check exists but has
 * never been activated — see `lib/fusionsolar/oauth-state.ts`). Revisit
 * once a real authorization has been completed and it's known whether
 * Sungrow actually returns this param.
 */

const SUNGROW_GATEWAY_BASE_URL = "https://gateway.isolarcloud.eu";

type SungrowTokenResponse = {
  result_code?: string;
  result_msg?: string;
  result_data?: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
};

export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.redirect(new URL("/login", process.env.AUTH_URL));
  }

  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    const url = new URL("/plants/connect", process.env.AUTH_URL);
    url.searchParams.set("isolarcloud", "missing_code");
    return NextResponse.redirect(url);
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, organizationId: true },
  });

  if (!user?.organizationId) {
    return NextResponse.redirect(new URL("/onboarding", process.env.AUTH_URL));
  }

  const state = request.nextUrl.searchParams.get("state");

  if (state) {
    const verifiedState = verifySungrowOAuthState(state);

    if (
      !verifiedState ||
      verifiedState.organizationId !== user.organizationId ||
      verifiedState.userId !== user.id
    ) {
      console.error("[Sungrow OAuth] state verification failed", {
        userId: user.id,
        organizationId: user.organizationId,
        statePresent: true,
      });

      const url = new URL("/plants/connect", process.env.AUTH_URL);
      url.searchParams.set("isolarcloud", "invalid_state");
      return NextResponse.redirect(url);
    }
  }

  const appKey = process.env.SUNGROW_APP_KEY;
  const appSecret = process.env.SUNGROW_APP_SECRET;
  const redirectUri = process.env.SUNGROW_REDIRECT_URI;

  if (!appKey || !appSecret || !redirectUri) {
    throw new Error("Sungrow OAuth environment variables are not configured");
  }

  const tokenResponse = await fetch(
    new URL("/openapi/apiManage/token", SUNGROW_GATEWAY_BASE_URL).toString(),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-access-key": appSecret,
      },
      body: JSON.stringify({
        appkey: appKey,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
      cache: "no-store",
    },
  );

  const responseText = await tokenResponse.text();

  let tokenData: SungrowTokenResponse;

  try {
    tokenData = JSON.parse(responseText) as SungrowTokenResponse;
  } catch {
    console.error("[Sungrow OAuth Token Exchange] Invalid JSON response", {
      status: tokenResponse.status,
      responseLength: responseText.length,
    });

    const url = new URL("/plants/connect", process.env.AUTH_URL);
    url.searchParams.set("isolarcloud", "token_exchange_failed");
    return NextResponse.redirect(url);
  }

  const accessToken = tokenData.result_data?.access_token;
  const refreshToken = tokenData.result_data?.refresh_token;

  if (!tokenResponse.ok || !accessToken || !refreshToken) {
    console.error("[Sungrow OAuth Token Exchange] Failed", {
      status: tokenResponse.status,
      resultCode: tokenData.result_code,
      resultMsg: tokenData.result_msg,
    });

    const url = new URL("/plants/connect", process.env.AUTH_URL);
    url.searchParams.set("isolarcloud", "token_exchange_failed");
    url.searchParams.set("reason", tokenData.result_msg ?? tokenData.result_code ?? `http_${tokenResponse.status}`);
    return NextResponse.redirect(url);
  }

  const expiresAt =
    typeof tokenData.result_data?.expires_in === "number"
      ? new Date(Date.now() + tokenData.result_data.expires_in * 1000)
      : null;

  await prisma.sungrowConnection.upsert({
    where: { organizationId: user.organizationId },
    update: { accessToken, refreshToken, expiresAt },
    create: { organizationId: user.organizationId, accessToken, refreshToken, expiresAt },
  });

  console.log("[Sungrow OAuth Token Exchange] Success", {
    userId: user.id,
    organizationId: user.organizationId,
    accessTokenStored: true,
    refreshTokenStored: true,
    expiresIn: tokenData.result_data?.expires_in,
  });

  const url = new URL("/plants/connect/isolarcloud", process.env.AUTH_URL);
  url.searchParams.set("isolarcloud", "token_exchange_ok");
  return NextResponse.redirect(url);
}
