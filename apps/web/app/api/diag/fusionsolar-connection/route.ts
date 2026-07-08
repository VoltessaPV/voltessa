import { NextResponse } from "next/server";

import { auth } from "@/auth";
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
      id: true,
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
      provider: true,
      accessToken: true,
      refreshToken: true,
      tokenType: true,
      scope: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true,
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

  const now = new Date();

  const accessTokenExpired =
    connection.expiresAt !== null && connection.expiresAt <= now;

  return NextResponse.json({
    ok: true,
    connection: {
      id: connection.id,
      provider: connection.provider,

      accessTokenStored: connection.accessToken.length > 0,
      accessTokenLength: connection.accessToken.length,

      refreshTokenStored: Boolean(connection.refreshToken),
      refreshTokenLength: connection.refreshToken?.length ?? 0,

      tokenType: connection.tokenType,
      scope: connection.scope,

      expiresAt: connection.expiresAt,
      accessTokenExpired,

      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    },
  });
}