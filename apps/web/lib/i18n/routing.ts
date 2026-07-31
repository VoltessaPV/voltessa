import { defineRouting } from "next-intl/routing";

/**
 * Full Internationalization milestone. Long-term supported set is eight
 * languages (see the approved architecture); this array is deliberately
 * just the two shipping in Phase 1. Adding a language later means adding
 * its code here once its `messages/<code>/*.json` files exist with real
 * content — never declaring a code with no content behind it.
 *
 * This is the *complete* set of locales this codebase has real translation
 * content for — `messages/<code>/*.json`, the terminology system, and every
 * i18n tooling script (`scripts/i18n/*.mjs`) all key off this array, and
 * keep validating every locale in it regardless of rollout status below.
 * Never remove a locale from here to take it out of production — see
 * `ENABLED_LOCALES`.
 */
export const LOCALES = ["en", "bg"] as const;

export type AppLocale = (typeof LOCALES)[number];

/** English is the source language every translation originates from (see docs/INTERNATIONALIZATION.md). */
export const DEFAULT_LOCALE: AppLocale = "en";

/**
 * Rollout gate: which of `LOCALES` are actually reachable in production
 * right now — deliberately separate from `LOCALES` itself. Bulgarian's
 * translations/infrastructure are complete (see docs/INTERNATIONALIZATION.md
 * for the full rationale) but intentionally disabled pending a full QA
 * pass; only this array controls that. `routing.locales` below (and
 * everything that reads it — the middleware, `generateStaticParams`,
 * sitemap/hreflang, the language switcher, `setLocale`) is driven by this
 * array, not by `LOCALES` — re-enabling Bulgarian is adding `"bg"` back
 * here, nothing else.
 */
export const ENABLED_LOCALES = ["en"] as const satisfies readonly AppLocale[];

/** Every locale in `LOCALES` that is NOT currently enabled — used only to redirect a disabled locale's URLs to their English equivalent (see `proxy.ts`). Empty once a locale is re-enabled, which turns that redirect into a no-op automatically. */
export const DISABLED_LOCALES = LOCALES.filter(
  (locale): locale is AppLocale => !(ENABLED_LOCALES as readonly AppLocale[]).includes(locale),
);

/** Whether the language switcher has anything to switch between — hides itself everywhere the moment a second locale is re-enabled, with no other code change. */
export const SHOW_LANGUAGE_SWITCHER = ENABLED_LOCALES.length > 1;

export const LOCALE_COOKIE_NAME = "voltessa-locale";

/**
 * `localePrefix: "always"` — explicit prefix for every enabled locale,
 * including English (`/en/dashboard`, not a bare `/dashboard` defaulting
 * silently to English) - "avoid a hidden default locale" was an explicit
 * requirement.
 *
 * `locales: ENABLED_LOCALES`, deliberately not `LOCALES` — this is the one
 * line that actually disables Bulgarian in production. Everything else in
 * the app (middleware, static params, sitemap, the language switcher) reads
 * `routing.locales`, never `LOCALES` directly, so this single line is the
 * entire rollout toggle.
 *
 * No `pathnames` map: route slugs (`/dashboard`, `/settings`, `/market`,
 * `/plants`, `/alerts`, ...) are identical across every locale by explicit
 * requirement - only UI text is translated, never the URL structure itself.
 * `/admin` and `/dev` are not part of this routing at all - see
 * `proxy.ts`'s matcher, which excludes them before this ever runs.
 */
export const routing = defineRouting({
  locales: ENABLED_LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "always",
  localeCookie: {
    name: LOCALE_COOKIE_NAME,
    maxAge: 60 * 60 * 24 * 365,
  },
});
