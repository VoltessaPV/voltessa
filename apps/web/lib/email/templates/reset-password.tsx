import { Button, Preview, render } from "react-email";

import { sendEmail } from "../service";
import { EmailHeading, EmailLayout, EmailText } from "./EmailLayout";

type ResetPasswordTemplateProps = {
  resetUrl: string;
};

export function ResetPasswordTemplate({ resetUrl }: ResetPasswordTemplateProps) {
  return (
    <EmailLayout>
      <Preview>Reset your Voltessa password</Preview>

      <EmailHeading>Reset your password</EmailHeading>

      <EmailText>We received a request to reset your password.</EmailText>

      <Button href={resetUrl} style={buttonStyle}>
        Reset Password
      </Button>

      <EmailText>
        This link expires in 60 minutes. If you didn&apos;t request a password reset you can
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
 * Renders `ResetPasswordTemplate` and hands the result to
 * `lib/email/service.ts`'s `sendEmail` - same shape as
 * `verify-email.tsx`'s `deliverVerificationEmail`, sharing `EmailLayout`
 * rather than duplicating any markup. Auth code (see
 * `lib/auth/password-reset.ts`) calls this, never `sendEmail` or a
 * provider directly.
 */
export async function deliverPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const html = await render(<ResetPasswordTemplate resetUrl={resetUrl} />);

  await sendEmail({
    to,
    subject: "Reset your Voltessa password",
    html,
  });
}
