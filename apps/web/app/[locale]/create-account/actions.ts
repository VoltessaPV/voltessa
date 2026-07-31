"use server";

import { redirect } from "next/navigation";

import { signIn } from "@/auth";
import { sendVerificationEmail } from "@/lib/auth/email-verification";
import { hashPassword, MINIMUM_PASSWORD_LENGTH } from "@/lib/auth/password";
import { prisma } from "@/lib/prisma";

export type RegisterErrorCode =
  | "registrationFieldsRequired"
  | "passwordTooShort"
  | "passwordsDoNotMatch"
  | "accountExistsWithPassword"
  | "accountExistsWithGoogle";
export type RegisterResult =
  | { success: false; code: RegisterErrorCode; params?: { min: number } }
  | null;

/** Same call as /login's - Google sign-in and sign-up are the same OAuth exchange; PrismaAdapter auto-provisions the User on first sign-in. */
export async function continueWithGoogle(): Promise<void> {
  await signIn("google", { redirectTo: "/dashboard" });
}

/**
 * Collects only email/password/confirmPassword - no phone/company/supplier;
 * that belongs to onboarding and Settings, not account creation. Does not
 * create a session - `emailVerified` stays null until the user clicks the
 * verification link (see `lib/auth/email-verification.ts`), and
 * `signInWithPassword` refuses to sign in an unverified account.
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
    return { success: false, code: "registrationFieldsRequired" };
  }

  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    return {
      success: false,
      code: "passwordTooShort",
      params: { min: MINIMUM_PASSWORD_LENGTH },
    };
  }

  if (password !== confirmPassword) {
    return { success: false, code: "passwordsDoNotMatch" };
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { passwordHash: true },
  });

  if (existing) {
    return existing.passwordHash
      ? { success: false, code: "accountExistsWithPassword" }
      : { success: false, code: "accountExistsWithGoogle" };
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.create({
    data: { email, passwordHash },
    select: { id: true },
  });

  await sendVerificationEmail(user.id, email);

  redirect(`/verify-email?email=${encodeURIComponent(email)}`);
}
