import { getRequestConfig } from "next-intl/server";

import { formats } from "@/lib/i18n/formatters";
import { DEFAULT_LOCALE, routing, type AppLocale } from "@/lib/i18n/routing";

function isSupportedLocale(value: string | undefined): value is AppLocale {
  return Boolean(value) && (routing.locales as readonly string[]).includes(value!);
}

/**
 * next-intl's request-scoped config — resolves which locale a Server
 * Component render is for and loads that locale's full merged message
 * tree. `requestLocale` comes from the `[locale]` route segment (set by
 * the middleware/routing config), never re-derived here.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale: AppLocale = isSupportedLocale(requested) ? requested : DEFAULT_LOCALE;

  const messages =
    locale === "bg"
      ? (await import("../messages/bg/index")).default
      : (await import("../messages/en/index")).default;

  return { locale, messages, formats };
});
