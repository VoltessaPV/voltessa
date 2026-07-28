import type { Email, EmailProvider } from "../provider";

/**
 * Default provider until Resend is wired up (Authentication System Refresh,
 * Phase 1 - no auth flow in this phase actually sends email yet, so this
 * exists purely so `lib/email/service.ts` has a real, working implementation
 * to delegate to from day one). Logs instead of sending - safe to run in any
 * environment, no API key required.
 */
export const consoleEmailProvider: EmailProvider = {
  name: "console",

  async send(email: Email): Promise<void> {
    console.log(`[Email] (console provider - not actually sent) to=${email.to} subject="${email.subject}"`);
    console.log(email.html);
  },
};
