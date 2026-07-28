/**
 * The generic email-provider abstraction, mirroring
 * `lib/notifications/provider.ts`'s existing shape for the same reason: the
 * rest of the app - auth flows today, welcome/billing/invitation/alert
 * emails later - talks only to `lib/email/service.ts`'s `sendEmail`, never
 * to a concrete provider. Adding a real provider (Resend) means adding a
 * new file under `lib/email/providers/` and pointing `service.ts` at it -
 * never changing a caller.
 */

export type Email = {
  to: string;
  subject: string;
  html: string;
};

export type EmailProvider = {
  /** Short, stable label for logging - e.g. "console", "resend". */
  name: string;
  send(email: Email): Promise<void>;
};
