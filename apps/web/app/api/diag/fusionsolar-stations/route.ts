import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getValidFusionSolarAccessToken } from "@/lib/fusionsolar/get-valid-access-token";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json(
      {
        ok: false,
        error: "unauthorized",
      },
      {
        status: 401,
      },
    );
  }

  const user = await prisma.user.findUnique({
    where: {
      email: session.user.email,
    },
    select: {
      organizationId: true,
    },
  });

  if (!user?.organizationId) {
    return NextResponse.json(
      {
        ok: false,
        error: "organization_not_found",
      },
      {
        status: 404,
      },
    );
  }

  const connection =
    await prisma.fusionSolarConnection.findUnique({
      where: {
        organizationId_provider: {
          organizationId: user.organizationId,
          provider: "HuaweiFusionSolar",
        },
      },
      select: {
        id: true,
        accessToken: true,
        refreshToken: true,
        tokenType: true,
        scope: true,
        expiresAt: true,
      },
    });

  if (!connection) {
    return NextResponse.json(
      {
        ok: false,
        error: "fusionsolar_connection_not_found",
      },
      {
        status: 404,
      },
    );
  }

  const gatewayUrl = process.env.FUSIONSOLAR_GATEWAY_URL;
  const gatewaySecret =
    process.env.FUSIONSOLAR_GATEWAY_SECRET;

  if (!gatewayUrl || !gatewaySecret) {
    return NextResponse.json(
      {
        ok: false,
        error: "fusionsolar_gateway_not_configured",
      },
      {
        status: 500,
      },
    );
  }

  try {
    const tokenResult =
      await getValidFusionSolarAccessToken(connection);

    const stationsUrl = new URL(
      "/v1/fusionsolar/stations",
      gatewayUrl,
    ).toString();

    const stationsResponse = await fetch(stationsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenResult.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json, */*",
        "x-gateway-secret": gatewaySecret,
      },
      body: JSON.stringify({
        pageNo: 1,
      }),
      cache: "no-store",
      redirect: "manual",
    });

    const responseText = await stationsResponse.text();

    let responseBody: unknown = responseText;

    try {
      responseBody = JSON.parse(responseText);
    } catch {
      // Keep the raw response text for diagnostics.
    }

    return NextResponse.json({
      ok: stationsResponse.ok,
      tokenRefreshed: tokenResult.refreshed,
      upstreamStatus: stationsResponse.status,
      upstreamContentType:
        stationsResponse.headers.get("content-type"),
      upstreamLocation:
        stationsResponse.headers.get("location"),
      response: responseBody,
    });
  } catch (error) {
    console.error("[FusionSolar Stations Diagnostic] Failed", {
      organizationId: user.organizationId,
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
            }
          : String(error),
    });

    return NextResponse.json(
      {
        ok: false,
        error: "fusionsolar_stations_diagnostic_failed",
        reason:
          error instanceof Error
            ? error.message
            : "unknown_error",
      },
      {
        status: 502,
      },
    );
  }
}
