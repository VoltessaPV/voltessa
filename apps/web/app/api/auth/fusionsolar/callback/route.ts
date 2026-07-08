import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.redirect(
      new URL("/login", process.env.AUTH_URL),
    );
  }

  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    const url = new URL("/settings", process.env.AUTH_URL);

    url.searchParams.set("fusionsolar", "error");
    url.searchParams.set("reason", error);

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

  console.log("[FusionSolar OAuth Callback]", {
    userId: user.id,
    organizationId: user.organizationId,
    codeReceived: true,
    codeLength: code.length,
  });

  const url = new URL("/settings", process.env.AUTH_URL);

  url.searchParams.set("fusionsolar", "callback_ok");

  return NextResponse.redirect(url);
}