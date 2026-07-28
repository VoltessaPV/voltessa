import { Resend } from "resend";

import type { Email, EmailProvider } from "../provider";

/**
 * The real provider, wired up via env vars only - `RESEND_API_KEY` (the
 * Resend account's secret key) and `EMAIL_FROM` (the verified sending
 * address, e.g. "Voltessa <noreply@voltessa.ai>" - requires the voltessa.ai
 * domain to be verified with Resend). Never hardcoded. Returns `null` when
 * either is unset so `lib/email/service.ts` can fall back to the console
 * provider instead of constructing a client with a missing key.
 */
export function createResendProvider(): EmailProvider | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    return null;
  }

  const client = new Resend(apiKey);

  return {
    name: "resend",

    async send(email: Email): Promise<void> {
      const result = await client.emails.send({
        from,
        to: email.to,
        subject: email.subject,
        html: email.html,
      });

      if (result.error) {
        throw new Error(`Resend responded with an error: ${result.error.message}`);
      }
    },
  };
}
