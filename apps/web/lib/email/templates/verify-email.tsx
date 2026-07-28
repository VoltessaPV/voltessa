import { Button, Preview, render } from "react-email";

import { sendEmail } from "../service";
import { EmailHeading, EmailLayout, EmailText } from "./EmailLayout";

type VerifyEmailTemplateProps = {
  verificationUrl: string;
};

export function VerifyEmailTemplate({ verificationUrl }: VerifyEmailTemplateProps) {
  return (
    <EmailLayout>
      <Preview>Verify your email address to activate your Voltessa account</Preview>

      <EmailHeading>Welcome to Voltessa</EmailHeading>

      <EmailText>Please verify your email address to activate your account.</EmailText>

      <Button href={verificationUrl} style={buttonStyle}>
        Verify Email
      </Button>

      <EmailText>
        If you didn&apos;t create this account you can safely ignore this email.
      </EmailText>
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
 * separate.
 */
export async function deliverVerificationEmail(
  to: string,
  verificationUrl: string,
): Promise<void> {
  const html = await render(<VerifyEmailTemplate verificationUrl={verificationUrl} />);

  await sendEmail({
    to,
    subject: "Verify your Voltessa account",
    html,
  });
}
