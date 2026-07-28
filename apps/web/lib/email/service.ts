import { consoleEmailProvider } from "./providers/console";
import { createResendProvider } from "./providers/resend";
import type { Email, EmailProvider } from "./provider";

const resendProvider = createResendProvider();

/**
 * Resend when `RESEND_API_KEY`/`EMAIL_FROM` are configured. In production,
 * a missing configuration is a deployment bug, not an expected state (the
 * voltessa.ai domain is verified with Resend and both env vars are
 * provisioned) - refuses to silently degrade, throwing instead so a
 * misconfiguration is loud and gets fixed immediately rather than quietly
 * losing email indefinitely. Outside production, missing credentials are
 * the normal case for a contributor's own machine, so the console
 * provider remains the fallback exactly as before - constructed once per
 * process, not per call, so its warning only ever logs once.
 */
function activeProvider(): EmailProvider {
  if (resendProvider) {
    return resendProvider;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[Email Service] RESEND_API_KEY/EMAIL_FROM are not configured. Email delivery is required in production - refusing to fall back silently.",
    );
  }

  console.warn(
    "[Email Service] RESEND_API_KEY/EMAIL_FROM are not configured — falling back to the console provider (development only).",
  );

  return consoleEmailProvider;
}

/**
 * The one function any auth/notification code should call to send an
 * email - never a concrete provider directly. A *delivery* failure (a
 * transient Resend API error) is logged server-side and swallowed here,
 * so registration/verification/resend flows always complete from the
 * caller's perspective even if the email itself didn't go out - the
 * account still exists and "Resend verification email" remains available.
 * A *configuration* failure (`activeProvider()` throwing in production) is
 * deliberately NOT swallowed here - see its own doc comment.
 */
export async function sendEmail(email: Email): Promise<void> {
  const provider = activeProvider();

  try {
    await provider.send(email);
  } catch (error) {
    console.error(`[Email Service] Failed to send email via "${provider.name}"`, error);
  }
}
