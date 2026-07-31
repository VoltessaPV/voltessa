"use server";

import { redirect } from "next/navigation";

import { signIn } from "@/auth";
import { createDatabaseSession } from "@/lib/auth/create-session";
import { verifyPassword } from "@/lib/auth/password";
import { syncUserLocale } from "@/lib/i18n/locale-sync";
import { prisma } from "@/lib/prisma";

export type SignInResult = { success: false; message: string } | null;

/** Unchanged from the previous /login page - moved here so both this page's actions live in one place. */
export async function continueWithGoogle(): Promise<void> {
  await signIn("google", { redirectTo: "/dashboard" });
}

/**
 * Never distinguishes "no such account", "account has no password" (a
 * Google-only account), or "wrong password" - a single generic result for
 * all three. `emailVerified` is checked only AFTER the password is
 * confirmed correct, specifically so an attacker can't use this endpoint
 * to enumerate which emails are registered-but-unverified without already
 * knowing the password - a Google-only account (no `passwordHash`) can
 * never reach the unverified branch either, since `passwordValid` is
 * false before that check runs, so Google sign-in is completely
 * unaffected by this phase.
 *
 * An unverified account never renders anything inline on this page - it
 * redirects to /verify-email?email=..., the same dedicated screen
 * registration lands on, with Resend already wired to that known email.
 * The credentials just typed here are never asked for again to resend.
 */
export async function signInWithPassword(
  _prevState: SignInResult,
  formData: FormData,
): Promise<SignInResult> {
  const email = formData.get("email");
  const password = formData.get("password");

  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return { success: false, message: "Email and password are required" };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      emailVerified: true,
      deletedAt: true,
      deactivatedAt: true,
    },
  });

  const passwordValid = user?.passwordHash
    ? await verifyPassword(password, user.passwordHash)
    : false;

  if (!user || !passwordValid) {
    return { success: false, message: "Invalid email or password" };
  }

  if (!user.emailVerified) {
    redirect(`/verify-email?email=${encodeURIComponent(user.email!)}`);
  }

  // Platform Administration milestone - same rule as Google's
  // callbacks.signIn in lib/auth/config.ts, checked after password/
  // verification (never reveal account status before proving the
  // password is even correct).
  if (user.deletedAt || user.deactivatedAt) {
    return { success: false, message: "This account is no longer active." };
  }

  await createDatabaseSession(user.id);

  // Password login never fires NextAuth's events.signIn (see
  // createDatabaseSession's own doc comment) - synced explicitly here for
  // the same reason lib/auth/config.ts does it for Google.
  await syncUserLocale(user.id);

  redirect("/dashboard");
}
