"use server";

/**
 * "Talk to Us" contact form submission (ContactModal). Public, unauthenticated
 * — this is a marketing-site form, not a platform action, so it does not go
 * through lib/auth/session.ts (there is no user/organization yet).
 *
 * Not connected to an email provider yet. Once Resend is configured, this
 * is the one place that changes: validation and the return contract below
 * stay the same, only the body replaces the console.log with a real send.
 */
export type ContactSubmissionResult = { ok: true } | { ok: false; error: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function submitContactRequest(
  formData: FormData,
): Promise<ContactSubmissionResult> {
  const fullName = formData.get("fullName")?.toString().trim() ?? "";
  const company = formData.get("company")?.toString().trim() ?? "";
  const email = formData.get("email")?.toString().trim() ?? "";
  const phone = formData.get("phone")?.toString().trim() ?? "";
  const country = formData.get("country")?.toString().trim() ?? "";
  const message = formData.get("message")?.toString().trim() ?? "";

  if (!fullName) {
    return { ok: false, error: "Full name is required." };
  }

  if (!company) {
    return { ok: false, error: "Company is required." };
  }

  if (!email) {
    return { ok: false, error: "Email is required." };
  }

  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  if (!message) {
    return { ok: false, error: "Message is required." };
  }

  // TODO: send via Resend once configured. For now: validate, log, succeed.
  console.log("[Contact] New landing page contact request", {
    fullName,
    company,
    email,
    phone: phone || null,
    country: country || null,
    message,
    submittedAt: new Date().toISOString(),
  });

  return { ok: true };
}
