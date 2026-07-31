import { Body, Container, Head, Heading, Html, Section, Text } from "react-email";

import { APP_NAME } from "@/lib/constants";
import type { AppLocale } from "@/lib/i18n/routing";

type EmailLayoutProps = {
  locale: AppLocale;
  footerText: string;
  children: React.ReactNode;
};

/**
 * The shared wrapper every Voltessa transactional email renders through -
 * verification today, welcome/billing/invitation/alert emails later (see
 * lib/email/service.ts). Reuses the app's own dark theme tokens directly
 * (bg-[#050816] page background, Card's #101728/border-slate-800 panel,
 * bg-blue-600 primary color - see components/ui/Card.tsx and Button.tsx)
 * rather than inventing a separate email palette. Solid colors only, no
 * translucency/backdrop effects - email clients render `rgba`/opacity
 * inconsistently, unlike the browser-only marketing/platform UI.
 */
export function EmailLayout({ locale, footerText, children }: EmailLayoutProps) {
  return (
    <Html lang={locale}>
      <Head />
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.brand}>
            <Text style={styles.brandText}>{APP_NAME}</Text>
          </Section>

          <Section style={styles.card}>{children}</Section>

          <Text style={styles.footer}>{footerText}</Text>
        </Container>
      </Body>
    </Html>
  );
}

export function EmailHeading({ children }: { children: React.ReactNode }) {
  return <Heading style={styles.heading}>{children}</Heading>;
}

export function EmailText({ children }: { children: React.ReactNode }) {
  return <Text style={styles.text}>{children}</Text>;
}

const styles = {
  body: {
    backgroundColor: "#050816",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    margin: 0,
    padding: "32px 16px",
  },
  container: {
    maxWidth: "480px",
    margin: "0 auto",
  },
  brand: {
    textAlign: "center" as const,
    marginBottom: "16px",
  },
  brandText: {
    color: "#ffffff",
    fontSize: "20px",
    fontWeight: 600,
    letterSpacing: "-0.02em",
    margin: 0,
  },
  card: {
    backgroundColor: "#101728",
    border: "1px solid #1e293b",
    borderRadius: "16px",
    padding: "32px",
  },
  heading: {
    color: "#ffffff",
    fontSize: "20px",
    fontWeight: 600,
    margin: "0 0 12px",
  },
  text: {
    color: "#94a3b8",
    fontSize: "14px",
    lineHeight: "22px",
    margin: "0 0 16px",
  },
  footer: {
    color: "#64748b",
    fontSize: "12px",
    textAlign: "center" as const,
    marginTop: "24px",
  },
};
