import { createTranslator } from "next-intl";

import enMessages from "@/messages/en/index";
import bgMessages from "@/messages/bg/index";

import { DEFAULT_LOCALE, routing, type AppLocale } from "@/lib/i18n/routing";
import { prisma } from "@/lib/prisma";

const MESSAGES_BY_LOCALE: Record<AppLocale, typeof enMessages> = {
  en: enMessages,
  bg: bgMessages,
};

/**
 * Checked against `routing.locales` (the currently *enabled* subset — see
 * routing.ts's rollout-gate doc comment), not the full `LOCALES` archive.
 * Emails follow the same production rollout gate as the web UI: while
 * Bulgarian is disabled pending QA, a stored `User.locale: "bg"` clamps to
 * `DEFAULT_LOCALE` here too (this function only ever reads the column,
 * never writes it, so the real stored preference is never touched - it
 * starts rendering in Bulgarian again automatically once re-enabled).
 */
function isEnabledLocale(value: string | null | undefined): value is AppLocale {
  return Boolean(value) && (routing.locales as readonly string[]).includes(value as AppLocale);
}

/**
 * Transactional emails render using the recipient's stored `User.locale`
 * (Full Internationalization milestone's explicit requirement) - never the
 * locale of whichever request happened to trigger the send, since sending
 * an email is often one step removed from any particular page render
 * (e.g. a resend triggered from /login's unverified-email branch). Falls
 * back to `DEFAULT_LOCALE` when the column is null (not yet synced - see
 * `lib/i18n/locale-sync.ts`), holds a value this codebase doesn't
 * recognize, or names a locale that's currently disabled (see
 * `isEnabledLocale`'s own doc comment).
 */
export async function resolveEmailLocale(userId: string): Promise<AppLocale> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { locale: true },
  });

  return isEnabledLocale(user?.locale) ? user.locale : DEFAULT_LOCALE;
}

/** Non-request-scoped translator (same `createTranslator` pattern as `lib/notifications/automation-notifications.ts`) for use outside the React tree/request lifecycle - email templates render via `react-email`'s `render()`, not a Server Component. */
export function createEmailTranslator(locale: AppLocale) {
  return createTranslator({ locale, messages: MESSAGES_BY_LOCALE[locale] });
}
