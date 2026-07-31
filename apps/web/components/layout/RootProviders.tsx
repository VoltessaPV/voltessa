import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";

import { ConsentProvider } from "@/components/consent/ConsentProvider";
import { CookieBanner } from "@/components/consent/CookieBanner";
import { CookiePreferencesModal } from "@/components/consent/CookiePreferencesModal";
import { getConsent } from "@/lib/consent/session";
import { formats } from "@/lib/i18n/formatters";
import type { AppLocale } from "@/lib/i18n/routing";

type RootProvidersProps = {
  locale: AppLocale;
  messages: Record<string, unknown>;
  children: ReactNode;
};

/**
 * Shared by all three root layouts (`app/[locale]/layout.tsx`,
 * `app/admin/layout.tsx`, `app/dev/layout.tsx`) so the
 * NextIntlClientProvider + consent wiring is declared exactly once. Admin
 * and dev pass a fixed `locale="en"` and the English message tree — "remain
 * English-only" is enforced right here, at this one boundary, rather than
 * every component underneath needing to special-case "am I in admin?".
 * Consent banner/modal are mounted for admin/dev too (they still set the
 * necessary auth cookie like everywhere else); they render in English there
 * for the same reason.
 */
export async function RootProviders({ locale, messages, children }: RootProvidersProps) {
  const consent = await getConsent();

  return (
    <NextIntlClientProvider locale={locale} messages={messages} formats={formats}>
      <ConsentProvider initialConsent={consent}>
        {children}
        <CookieBanner />
        <CookiePreferencesModal />
      </ConsentProvider>
    </NextIntlClientProvider>
  );
}
