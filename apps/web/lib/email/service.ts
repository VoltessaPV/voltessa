import { consoleEmailProvider } from "./providers/console";
import type { Email } from "./provider";

/**
 * The one function any future auth/notification code should call to send
 * an email - never a concrete provider directly. Delegates to the console
 * provider today; swapping in Resend once `RESEND_API_KEY`/`EMAIL_FROM` are
 * provisioned is a one-line change to this file only, no caller changes.
 */
export async function sendEmail(email: Email): Promise<void> {
  await consoleEmailProvider.send(email);
}
