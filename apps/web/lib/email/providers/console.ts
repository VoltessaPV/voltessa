import type { Email, EmailProvider } from "../provider";

/**
 * Fallback provider used whenever `RESEND_API_KEY`/`EMAIL_FROM` aren't
 * configured (see `lib/email/service.ts`) - local dev without real
 * credentials, or a genuinely misconfigured deployment. Logs instead of
 * sending - safe to run in any environment, no API key required.
 */
export const consoleEmailProvider: EmailProvider = {
  name: "console",

  async send(email: Email): Promise<void> {
    console.log(`[Email] (console provider - not actually sent) to=${email.to} subject="${email.subject}"`);
    console.log(email.html);
  },
};
