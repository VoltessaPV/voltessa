import { createTranslator } from "next-intl";

import enMessages from "@/messages/en/index";
import bgMessages from "@/messages/bg/index";

import { DEFAULT_LOCALE, LOCALES, type AppLocale } from "@/lib/i18n/routing";
import { prisma } from "@/lib/prisma";

const MESSAGES_BY_LOCALE: Record<AppLocale, typeof enMessages> = {
  en: enMessages,
  bg: bgMessages,
};

function isAppLocale(value: string | null | undefined): value is AppLocale {
  return LOCALES.includes(value as AppLocale);
}

/**
 * Transactional emails render using the recipient's stored `User.locale`
 * (Full Internationalization milestone's explicit requirement) - never the
 * locale of whichever request happened to trigger the send, since sending
 * an email is often one step removed from any particular page render
 * (e.g. a resend triggered from /login's unverified-email branch). Falls
 * back to `DEFAULT_LOCALE` when the column is null (not yet synced - see
 * `lib/i18n/locale-sync.ts`) or holds a value that isn't a currently
 * supported locale.
 */
export async function resolveEmailLocale(userId: string): Promise<AppLocale> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { locale: true },
  });

  return isAppLocale(user?.locale) ? user.locale : DEFAULT_LOCALE;
}

/** Non-request-scoped translator (same `createTranslator` pattern as `lib/notifications/automation-notifications.ts`) for use outside the React tree/request lifecycle - email templates render via `react-email`'s `render()`, not a Server Component. */
export function createEmailTranslator(locale: AppLocale) {
  return createTranslator({ locale, messages: MESSAGES_BY_LOCALE[locale] });
}
