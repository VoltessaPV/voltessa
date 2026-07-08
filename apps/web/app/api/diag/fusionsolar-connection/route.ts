import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getValidFusionSolarAccessToken } from "@/lib/fusionsolar/get-valid-access-token";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const preferredRegion = "fra1";

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

  const connection = await prisma.fusionSolarConnection.findUnique({
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

  try {
    const tokenResult =
      await getValidFusionSolarAccessToken(connection);

    const updatedConnection =
      await prisma.fusionSolarConnection.findUnique({
        where: {
          id: connection.id,
        },
        select: {
          tokenType: true,
          scope: true,
          expiresAt: true,
          updatedAt: true,
        },
      });

    return NextResponse.json({
      ok: true,
      token: {
        validAccessTokenAvailable:
          tokenResult.accessToken.length > 0,
        refreshed: tokenResult.refreshed,
      },
      connection: {
        tokenType: updatedConnection?.tokenType ?? null,
        scope: updatedConnection?.scope ?? null,
        expiresAt: updatedConnection?.expiresAt ?? null,
        updatedAt: updatedConnection?.updatedAt ?? null,
      },
    });
  } catch (error) {
    console.error("[FusionSolar Token Diagnostic] Failed", {
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
        error: "fusionsolar_token_validation_failed",
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
