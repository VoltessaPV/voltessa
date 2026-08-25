import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { createSungrowOAuthState } from "@/lib/isolarcloud/oauth-state";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * Mirrors `app/api/auth/fusionsolar/connect/route.ts` exactly (auth check,
 * organization check, env-configured app identity, redirect). One
 * structural difference: Sungrow's authorization URL is a Developer-Portal
 * SPA route (`#/authorized-app?...`), not a classic `/oauth2/authorize`
 * endpoint — confirmed directly from the real URL the user's own portal
 * shows for the Voltessa application, not third-party-derived. Query
 * params therefore have to be appended after the `#` fragment manually;
 * `URL#searchParams` does not apply to a fragment.
 *
 * Region is hardcoded to Europe (`cloudId=3`, `web3.isolarcloud.eu`) —
 * matches the EU authorization URL already configured for this
 * application. Not sourced from official documentation (portal access
 * could not be reached) — see `lib/isolarcloud/api-client.ts`'s top doc
 * comment for the same caveat applied to every other Sungrow endpoint in
 * this codebase.
 *
 * Includes a `state` param (unlike Huawei's own dormant equivalent, which
 * this codebase never activated) — see `callback/route.ts` for how it's
 * verified, and `lib/isolarcloud/oauth-state.ts` for the open question of
 * whether Sungrow's redirect actually echoes it back.
 */

const SUNGROW_AUTHORIZE_BASE_URL = "https://web3.isolarcloud.eu";
const SUNGROW_CLOUD_ID = "3";

export async function GET() {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.redirect(new URL("/login", process.env.AUTH_URL));
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, organizationId: true },
  });

  if (!user?.organizationId) {
    return NextResponse.redirect(new URL("/onboarding", process.env.AUTH_URL));
  }

  const applicationId = process.env.SUNGROW_APPLICATION_ID;
  const redirectUri = process.env.SUNGROW_REDIRECT_URI;

  if (!applicationId || !redirectUri) {
    throw new Error("Sungrow OAuth environment variables are not configured");
  }

  const state = createSungrowOAuthState({ organizationId: user.organizationId, userId: user.id });

  const params = new URLSearchParams();

  params.set("cloudId", SUNGROW_CLOUD_ID);
  params.set("applicationId", applicationId);
  params.set("redirectUrl", redirectUri);
  params.set("state", state);

  const authorizationUrl = `${SUNGROW_AUTHORIZE_BASE_URL}/#/authorized-app?${params.toString()}`;

  return NextResponse.redirect(authorizationUrl);
}
