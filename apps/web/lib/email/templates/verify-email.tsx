import { Button, Preview, render } from "react-email";

import { sendEmail } from "../service";
import { EmailHeading, EmailLayout, EmailText } from "./EmailLayout";

type VerifyEmailTemplateProps = {
  verificationUrl: string;
};

export function VerifyEmailTemplate({ verificationUrl }: VerifyEmailTemplateProps) {
  return (
    <EmailLayout>
      <Preview>Verify your email to finish setting up your Voltessa account</Preview>

      <EmailHeading>Verify your email</EmailHeading>

      <EmailText>
        Click the button below to verify your email address and finish setting up your
        Voltessa account.
      </EmailText>

      <Button href={verificationUrl} style={buttonStyle}>
        Verify email
      </Button>

      <EmailText>
        This link expires in 24 hours. If you didn&apos;t create a Voltessa account, you can
        safely ignore this email.
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
    subject: "Verify your email",
    html,
  });
}
