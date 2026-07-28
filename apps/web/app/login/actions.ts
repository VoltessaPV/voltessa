"use server";

import { redirect } from "next/navigation";

import { signIn } from "@/auth";
import { createDatabaseSession } from "@/lib/auth/create-session";
import { verifyPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/prisma";

export type SignInResult = { success: false; message: string } | null;

/** Unchanged from the previous /login page - moved here so both this page's actions live in one place. */
export async function continueWithGoogle(): Promise<void> {
  await signIn("google", { redirectTo: "/dashboard" });
}

/**
 * Never distinguishes "no such account", "account has no password" (a
 * Google-only account), or "wrong password" in the returned message - a
 * single generic result for all three, standard practice for a login form
 * specifically (unlike registration, where naming the conflict is normal
 * SaaS UX - see registerWithPassword).
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
    select: { id: true, passwordHash: true },
  });

  const passwordValid = user?.passwordHash
    ? await verifyPassword(password, user.passwordHash)
    : false;

  if (!user || !passwordValid) {
    return { success: false, message: "Invalid email or password" };
  }

  await createDatabaseSession(user.id);

  redirect("/dashboard");
}
