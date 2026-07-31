import { Button, Preview, render } from "react-email";

import { APP_NAME } from "@/lib/constants";
import type { AppLocale } from "@/lib/i18n/routing";

import { createEmailTranslator, resolveEmailLocale } from "../locale";
import { sendEmail } from "../service";
import { EmailHeading, EmailLayout, EmailText } from "./EmailLayout";

type VerifyEmailTemplateProps = {
  verificationUrl: string;
  locale: AppLocale;
};

export function VerifyEmailTemplate({ verificationUrl, locale }: VerifyEmailTemplateProps) {
  const t = createEmailTranslator(locale);

  return (
    <EmailLayout locale={locale} footerText={t("emails.layout.footer", { appName: APP_NAME })}>
      <Preview>{t("emails.verifyEmail.preview")}</Preview>

      <EmailHeading>{t("emails.verifyEmail.heading")}</EmailHeading>

      <EmailText>{t("emails.verifyEmail.body")}</EmailText>

      <Button href={verificationUrl} style={buttonStyle}>
        {t("emails.verifyEmail.button")}
      </Button>

      <EmailText>{t("emails.verifyEmail.footnote")}</EmailText>
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
 * Renders `VerifyEmailTemplate` and hands the result to
 * `lib/email/service.ts`'s `sendEmail` - the only place this template
 * touches the generic email-sending layer. Auth code (see
 * `lib/auth/email-verification.ts`) calls this, never `sendEmail` or a
 * provider directly, keeping template content and delivery mechanics
 * separate. Renders using the recipient's own stored `User.locale`
 * (`resolveEmailLocale`, Full Internationalization milestone) - never the
 * locale of whatever request triggered the send.
 */
export async function deliverVerificationEmail(
  to: string,
  verificationUrl: string,
  userId: string,
): Promise<void> {
  const locale = await resolveEmailLocale(userId);
  const t = createEmailTranslator(locale);
  const html = await render(<VerifyEmailTemplate verificationUrl={verificationUrl} locale={locale} />);

  await sendEmail({
    to,
    subject: t("emails.verifyEmail.subject"),
    html,
  });
}
