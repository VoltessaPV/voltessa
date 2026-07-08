import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export const preferredRegion = "fra1";

const FUSIONSOLAR_TOKEN_URL =
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

export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.redirect(
      new URL("/login", process.env.AUTH_URL),
    );
  }

  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const errorDescription =
    request.nextUrl.searchParams.get("error_description");

  if (error) {
    const url = new URL("/settings", process.env.AUTH_URL);

    url.searchParams.set("fusionsolar", "error");
    url.searchParams.set(
      "reason",
      errorDescription ?? error,
    );

    return NextResponse.redirect(url);
  }

  if (!code) {
    const url = new URL("/settings", process.env.AUTH_URL);

    url.searchParams.set("fusionsolar", "missing_code");

    return NextResponse.redirect(url);
  }

  const user = await prisma.user.findUnique({
    where: {
      email: session.user.email,
    },
    select: {
      id: true,
      organizationId: true,
    },
  });

  if (!user?.organizationId) {
    return NextResponse.redirect(
      new URL("/onboarding", process.env.AUTH_URL),
    );
  }

  const clientId = process.env.FUSIONSOLAR_CLIENT_ID;
  const clientSecret = process.env.FUSIONSOLAR_CLIENT_SECRET;
  const redirectUri = process.env.FUSIONSOLAR_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "FusionSolar OAuth environment variables are not configured",
    );
  }

  const body = new URLSearchParams();

  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("redirect_uri", redirectUri);

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
    console.error(
      "[FusionSolar OAuth Token Exchange] Invalid JSON response",
      {
        status: tokenResponse.status,
        contentType: tokenResponse.headers.get("content-type"),
        responseLength: responseText.length,
      },
    );

    const url = new URL("/settings", process.env.AUTH_URL);

    url.searchParams.set("fusionsolar", "token_exchange_failed");
    url.searchParams.set("reason", "invalid_token_response");

    return NextResponse.redirect(url);
  }

  if (
    !tokenResponse.ok ||
    !tokenData.access_token ||
    !tokenData.refresh_token
  ) {
    console.error("[FusionSolar OAuth Token Exchange] Failed", {
      status: tokenResponse.status,
      error: tokenData.error,
      errorDescription: tokenData.error_description,
    });

    const url = new URL("/settings", process.env.AUTH_URL);

    url.searchParams.set("fusionsolar", "token_exchange_failed");
    url.searchParams.set(
      "reason",
      tokenData.error_description ??
        tokenData.error ??
        `http_${tokenResponse.status}`,
    );

    return NextResponse.redirect(url);
  }

  const expiresAt =
    typeof tokenData.expires_in === "number"
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : null;

  await prisma.fusionSolarConnection.upsert({
    where: {
      organizationId_provider: {
        organizationId: user.organizationId,
        provider: "HuaweiFusionSolar",
      },
    },
    update: {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenType: tokenData.token_type ?? null,
      scope: tokenData.scope ?? null,
      expiresAt,
    },
    create: {
      organizationId: user.organizationId,
      provider: "HuaweiFusionSolar",
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenType: tokenData.token_type ?? null,
      scope: tokenData.scope ?? null,
      expiresAt,
    },
  });

  console.log("[FusionSolar OAuth Token Exchange] Success", {
    userId: user.id,
    organizationId: user.organizationId,
    accessTokenStored: true,
    refreshTokenStored: true,
    expiresIn: tokenData.expires_in,
    scope: tokenData.scope,
    tokenType: tokenData.token_type,
  });

  const url = new URL("/settings", process.env.AUTH_URL);

  url.searchParams.set("fusionsolar", "token_exchange_ok");

  return NextResponse.redirect(url);
}
