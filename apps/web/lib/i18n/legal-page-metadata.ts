import type { Metadata } from "next";
import { hasLocale } from "next-intl";

import { buildCanonicalUrl, buildLanguageAlternates } from "./seo";
import { routing, type AppLocale } from "./routing";

/**
 * Shared by the four legal pages (Privacy/Terms/Cookie Policy/Company) —
 * each has real, distinct, publicly indexable content per locale, so each
 * gets its own self-canonical + full `hreflang` set for its own path,
 * overriding the root `[locale]` layout's default (which only covers "/").
 */
export function buildLegalPageMetadata(
  locale: string,
  pathname: string,
  title: string,
): Metadata {
  const appLocale = (hasLocale(routing.locales, locale) ? locale : routing.defaultLocale) as AppLocale;

  return {
    title,
    alternates: {
      canonical: buildCanonicalUrl(appLocale, pathname),
      languages: buildLanguageAlternates(pathname),
    },
  };
}
