import { defineRouting } from "next-intl/routing";

/**
 * Full Internationalization milestone. Long-term supported set is eight
 * languages (see the approved architecture); this array is deliberately
 * just the two shipping in Phase 1. Adding a language later means adding
 * its code here once its `messages/<code>/*.json` files exist with real
 * content — never declaring a code with no content behind it.
 */
export const LOCALES = ["en", "bg"] as const;

export type AppLocale = (typeof LOCALES)[number];

/** English is the source language every translation originates from (see docs/INTERNATIONALIZATION.md). */
export const DEFAULT_LOCALE: AppLocale = "en";

export const LOCALE_COOKIE_NAME = "voltessa-locale";

/**
 * `localePrefix: "always"` — explicit prefix for every locale, including
 * English (`/en/dashboard`, not a bare `/dashboard` defaulting silently to
 * English) - "avoid a hidden default locale" was an explicit requirement.
 *
 * No `pathnames` map: route slugs (`/dashboard`, `/settings`, `/market`,
 * `/plants`, `/alerts`, ...) are identical across every locale by explicit
 * requirement - only UI text is translated, never the URL structure itself.
 * `/admin` and `/dev` are not part of this routing at all - see
 * `proxy.ts`'s matcher, which excludes them before this ever runs.
 */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "always",
  localeCookie: {
    name: LOCALE_COOKIE_NAME,
    maxAge: 60 * 60 * 24 * 365,
  },
});
