import { NextResponse } from "next/server";

import { createDatabaseSession } from "@/lib/auth/create-session";
import { consumeEmailVerificationToken } from "@/lib/auth/email-verification";

/**
 * The one place an `EmailVerificationToken` is actually consumed - a plain
 * GET so the emailed link works as a normal clickable link. Deliberately a
 * separate Route Handler rather than folding the mutation into
 * `/verify-email`'s own page.tsx: that page only ever displays state from
 * its query params, it never performs a side effect during render. A
 * link-safety scanner or accidental double-fetch that hits this route a
 * second time after a token is already consumed just reads "invalid" (the
 * row is gone), never a corrupted or re-verified state.
 *
 * On success, signs the user straight in (via the same `createDatabaseSession`
 * helper password login uses) and lands on `/dashboard` with a success
 * toast - clicking the link is the whole verification experience, no
 * separate manual login step required.
 */
export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(new URL("/verify-email?status=invalid", request.url));
  }

  const result = await consumeEmailVerificationToken(token);

  if (result.ok) {
    await createDatabaseSession(result.userId);
    return NextResponse.redirect(new URL("/dashboard?toast=email-verified", request.url));
  }

  if (result.reason === "expired") {
    const target = new URL("/verify-email", request.url);
    target.searchParams.set("status", "expired");
    if (result.email) {
      target.searchParams.set("email", result.email);
    }
    return NextResponse.redirect(target);
  }

  return NextResponse.redirect(new URL("/verify-email?status=invalid", request.url));
}
