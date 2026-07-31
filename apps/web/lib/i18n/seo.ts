import { routing, type AppLocale } from "./routing";

const BASE_URL = "https://voltessa.ai";

/**
 * `alternates.languages` for a given un-prefixed pathname (e.g. `""` for
 * home, `"/privacy"`) — one entry per currently active locale plus
 * `x-default` pointing at English. Adding a language later (Phase 2) means
 * adding its code to `routing.ts`'s `LOCALES` array; this picks it up with
 * no further change, since it iterates that array rather than a fixed list.
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
