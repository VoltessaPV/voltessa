import { Button, Preview, render } from "react-email";

import { APP_NAME } from "@/lib/constants";
import type { AppLocale } from "@/lib/i18n/routing";

import { createEmailTranslator, resolveEmailLocale } from "../locale";
import { sendEmail } from "../service";
import { EmailHeading, EmailLayout, EmailText } from "./EmailLayout";

type ResetPasswordTemplateProps = {
  resetUrl: string;
  locale: AppLocale;
};

export function ResetPasswordTemplate({ resetUrl, locale }: ResetPasswordTemplateProps) {
  const t = createEmailTranslator(locale);

  return (
    <EmailLayout locale={locale} footerText={t("emails.layout.footer", { appName: APP_NAME })}>
      <Preview>{t("emails.resetPassword.preview")}</Preview>

      <EmailHeading>{t("emails.resetPassword.heading")}</EmailHeading>

      <EmailText>{t("emails.resetPassword.body")}</EmailText>

      <Button href={resetUrl} style={buttonStyle}>
        {t("emails.resetPassword.button")}
      </Button>

      <EmailText>{t("emails.resetPassword.footnote")}</EmailText>
    </EmailLayout>
  );
}

const buttonStyle = {
  backgroundColor: "#2563eb",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: 600,
  textDecoration: "none",
  borderRadius: "12px",
  padding: "12px 24px",
  display: "inline-block",
};

/**
 * Renders `ResetPasswordTemplate` and hands the result to
 * `lib/email/service.ts`'s `sendEmail` - same shape as
 * `verify-email.tsx`'s `deliverVerificationEmail`, sharing `EmailLayout`
 * rather than duplicating any markup. Auth code (see
 * `lib/auth/password-reset.ts`) calls this, never `sendEmail` or a
 * provider directly. Renders using the recipient's own stored
 * `User.locale` (`resolveEmailLocale`, Full Internationalization
 * milestone) - never the locale of whatever request triggered the send.
 */
export async function deliverPasswordResetEmail(
  to: string,
  resetUrl: string,
  userId: string,
): Promise<void> {
  const locale = await resolveEmailLocale(userId);
  const t = createEmailTranslator(locale);
  const html = await render(<ResetPasswordTemplate resetUrl={resetUrl} locale={locale} />);

  await sendEmail({
    to,
    subject: t("emails.resetPassword.subject"),
    html,
  });
}
