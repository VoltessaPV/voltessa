"use server";

import { redirect } from "next/navigation";

import { signOut } from "@/auth";
import { APP_URL } from "@/lib/constants";

/**
 * Signs the current user out and lands them on the marketing landing page
 * (voltessa.ai), not /login - the natural destination after logout.
 * `signOut({ redirect: false })` skips NextAuth's own redirect: its
 * default `redirect` callback only allows same-origin targets (verified
 * directly against `@auth/core` source - a URL whose origin doesn't match
 * `AUTH_URL`'s falls back to `AUTH_URL` itself), so a cross-subdomain
 * destination like this has to be a plain Next.js `redirect()` afterward
 * instead. Session invalidation (deleting the database `Session` row,
 * clearing cookies) happens identically either way - only the final
 * redirect target changes.
 */
export async function signOutAction(): Promise<void> {
  await signOut({ redirect: false });
  redirect(APP_URL);
}
