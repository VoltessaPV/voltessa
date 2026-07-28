"use server";

import { redirect } from "next/navigation";

import { signIn } from "@/auth";
import { createDatabaseSession } from "@/lib/auth/create-session";
import { hashPassword, MINIMUM_PASSWORD_LENGTH } from "@/lib/auth/password";
import { prisma } from "@/lib/prisma";

export type RegisterResult = { success: false; message: string } | null;

/** Same call as /login's - Google sign-in and sign-up are the same OAuth exchange; PrismaAdapter auto-provisions the User on first sign-in. */
export async function continueWithGoogle(): Promise<void> {
  await signIn("google", { redirectTo: "/dashboard" });
}

/**
 * Collects only email/password/confirmPassword - no phone/company/supplier;
 * that belongs to onboarding and Settings, not account creation. Email
 * verification doesn't exist yet in this phase, so a new account is
 * immediately usable (`emailVerified` stays null, honestly reflecting that
 * nothing checks it yet) - a later phase adds the gate and the email.
 */
export async function registerWithPassword(
  _prevState: RegisterResult,
  formData: FormData,
): Promise<RegisterResult> {
  const email = formData.get("email");
  const password = formData.get("password");
  const confirmPassword = formData.get("confirmPassword");

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    typeof confirmPassword !== "string" ||
    !email
  ) {
    return { success: false, message: "Email, password, and confirmation are required" };
  }

  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    return {
      success: false,
      message: `Password must be at least ${MINIMUM_PASSWORD_LENGTH} characters`,
    };
  }

  if (password !== confirmPassword) {
    return { success: false, message: "Passwords do not match" };
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { passwordHash: true },
  });

  if (existing) {
    return existing.passwordHash
      ? { success: false, message: "An account with this email already exists. Log in instead." }
      : {
          success: false,
          message:
            "This email already has a Voltessa account via Google. Log in with Google instead.",
        };
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.create({
    data: { email, passwordHash },
    select: { id: true },
  });

  await createDatabaseSession(user.id);

  redirect("/dashboard");
}
