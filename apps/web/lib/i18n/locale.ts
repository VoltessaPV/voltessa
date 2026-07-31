import { cookies, headers } from "next/headers";

import { LOCALE_COOKIE_NAME } from "@/lib/consent/constants";

export type Locale = "en" | "bg";

/**
 * Scoped locale resolution for the compliance surfaces only (consent
 * banner/modal, Privacy Policy, Cookie Policy, Terms of Service, Company
 * Information) — the rest of the site (marketing copy, the authenticated
 * product) stays English-only, a deliberate scope decision for this
 * milestone rather than adopting sitewide i18n (which would need its own
 * ADR — see the GDPR + Cookie Consent Platform design proposal, section 6).
 *
 * Resolution order: the `voltessa-locale` cookie (set via the EN/BG toggle
 * on these pages) if present, otherwise a plain `Accept-Language` sniff for
 * a Bulgarian preference, otherwise English. No new dependency — full
 * RFC 4647 language-negotiation is more than this narrow surface needs.
 */
export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;

  if (cookieLocale === "en" || cookieLocale === "bg") {
    return cookieLocale;
  }

  const headerList = await headers();
  const acceptLanguage = headerList.get("accept-language") ?? "";

  return acceptLanguage.toLowerCase().startsWith("bg") ? "bg" : "en";
}
