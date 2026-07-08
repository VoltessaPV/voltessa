import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { verifyFusionSolarOAuthState } from "@/lib/fusionsolar/oauth-state";
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
  const state = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    const url = new URL("/settings", process.env.AUTH_URL);
    url.searchParams.set("fusionsolar", "error");
    url.searchParams.set("reason", error);

    return NextResponse.redirect(url);
  }

  if (!code || !state) {
    const url = new URL("/settings", process.env.AUTH_URL);
    url.searchParams.set("fusionsolar", "invalid_callback");

    return NextResponse.redirect(url);
  }

  const statePayload = verifyFusionSolarOAuthState(state);

  if (!statePayload) {
    const url = new URL("/settings", process.env.AUTH_URL);
    url.searchParams.set("fusionsolar", "invalid_state");

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

  if (
    !user?.organizationId ||
    user.id !== statePayload.userId ||
    user.organizationId !== statePayload.organizationId
  ) {
    const url = new URL("/settings", process.env.AUTH_URL);
    url.searchParams.set("fusionsolar", "state_mismatch");

    return NextResponse.redirect(url);
  }

  const url = new URL("/settings", process.env.AUTH_URL);
  url.searchParams.set("fusionsolar", "callback_ok");

  return NextResponse.redirect(url);
}