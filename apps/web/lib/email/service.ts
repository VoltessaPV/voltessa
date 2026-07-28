import { consoleEmailProvider } from "./providers/console";
import { createResendProvider } from "./providers/resend";
import type { Email } from "./provider";

const resendProvider = createResendProvider();

/**
 * Resend when `RESEND_API_KEY`/`EMAIL_FROM` are configured, otherwise the
 * console provider - constructed once per process, not per call, so the
 * "not configured" warning below only ever logs once instead of on every
 * send.
 */
function activeProvider() {
  if (resendProvider) {
    return resendProvider;
  }

  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[Email Service] RESEND_API_KEY/EMAIL_FROM are not configured — emails will not actually be sent.",
    );
  } else {
    console.warn(
      "[Email Service] RESEND_API_KEY/EMAIL_FROM are not configured — falling back to the console provider (development only).",
    );
  }

  return consoleEmailProvider;
}

/**
 * The one function any auth/notification code should call to send an
 * email - never a concrete provider directly. Never throws: a delivery
 * failure (missing config, a Resend API error) is logged server-side and
 * swallowed here, so registration/verification/resend flows always
 * complete from the caller's perspective even if the email itself didn't
 * go out - the account still exists and "Resend verification email"
 * remains available.
 */
export async function sendEmail(email: Email): Promise<void> {
  const provider = activeProvider();

  try {
    await provider.send(email);
  } catch (error) {
    console.error(`[Email Service] Failed to send email via "${provider.name}"`, error);
  }
}
