import { routing, type AppLocale } from "./routing";

const BASE_URL = "https://voltessa.ai";

/**
 * `alternates.languages` for a given un-prefixed pathname (e.g. `""` for
 * home, `"/privacy"`) — one entry per currently *enabled* locale
 * (`routing.locales`, not the full `LOCALES` archive — see routing.ts's
 * rollout-gate doc comment, e.g. Bulgarian while it's disabled pending QA)
 * plus `x-default` pointing at English. Enabling a disabled language, or
 * adding a new one, means updating `routing.ts`'s `ENABLED_LOCALES`; this
 * picks it up with no further change, since it iterates that array rather
 * than a fixed list.
 */
export function buildLanguageAlternates(pathname: string): Record<string, string> {
  const languages: Record<string, string> = {};

  for (const locale of routing.locales) {
    languages[locale] = `${BASE_URL}/${locale}${pathname}`;
  }

  languages["x-default"] = `${BASE_URL}/${routing.defaultLocale}${pathname}`;

  return languages;
}

/** The canonical URL for a given locale + un-prefixed pathname — always itself, never the English version, since each locale is genuinely distinct content. */
export function buildCanonicalUrl(locale: AppLocale, pathname: string): string {
  return `${BASE_URL}/${locale}${pathname}`;
}
