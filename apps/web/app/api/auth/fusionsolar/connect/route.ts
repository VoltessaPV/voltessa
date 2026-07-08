import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const FUSIONSOLAR_AUTHORIZE_URL =
  "https://oauth2.fusionsolar.huawei.com/rest/dp/uidm/oauth2/v1/login-page";

export async function GET() {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.redirect(
      new URL("/login", process.env.AUTH_URL),
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
    return NextResponse.redirect(
      new URL("/onboarding", process.env.AUTH_URL),
    );
  }

  const clientId = process.env.FUSIONSOLAR_CLIENT_ID;
  const redirectUri = process.env.FUSIONSOLAR_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    throw new Error(
      "FusionSolar OAuth environment variables are not configured",
    );
  }

  const authorizationUrl = new URL(FUSIONSOLAR_AUTHORIZE_URL);

authorizationUrl.searchParams.set("response_type", "code");
authorizationUrl.searchParams.set("client_id", clientId);
authorizationUrl.searchParams.set("redirect_uri", redirectUri);
authorizationUrl.searchParams.set(
  "scope",
  "pvms.openapi.basic pvms.openapi.control",
);
authorizationUrl.searchParams.set("locale", "bg-BG");

console.log(
  "[FusionSolar OAuth] Authorization URL:",
  authorizationUrl.toString(),
);

  return NextResponse.redirect(authorizationUrl);
}