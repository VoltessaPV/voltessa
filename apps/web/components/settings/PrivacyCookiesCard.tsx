import { getTranslations } from "next-intl/server";

import { CookieSettingsLink } from "@/components/consent/CookieSettingsLink";
import { routes } from "@/lib/routes";

import { SettingsCard } from "./SettingsCard";

/**
 * GDPR + Cookie Consent Platform milestone. The authenticated-app
 * counterpart to the footer's "Cookie Settings" entry — the marketing
 * Footer only renders on the marketing homepage and the four compliance
 * pages, never under `(platform)`, so signed-in users need their own path
 * back to the same preferences modal. Rendered for both Plant Owner and
 * Energy Trader Settings (see `app/(platform)/settings/page.tsx`) since
 * cookie preferences aren't organization-scoped — every signed-in user
 * needs this regardless of role.
 */
export async function PrivacyCookiesCard() {
  const t = await getTranslations("settings.privacyCookies");

  return (
    <SettingsCard title={t("title")} description={t("description")}>
      <div className="flex flex-wrap items-center gap-3">
        <CookieSettingsLink className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10">
          {t("manageCookiePreferencesButton")}
        </CookieSettingsLink>

        <a
          href={routes.privacy}
          className="text-sm text-slate-400 underline-offset-4 transition hover:text-white hover:underline"
        >
          {t("privacyPolicyLink")}
        </a>

        <a
          href={routes.cookiePolicy}
          className="text-sm text-slate-400 underline-offset-4 transition hover:text-white hover:underline"
        >
          {t("cookiePolicyLink")}
        </a>

        <a
          href={routes.terms}
          className="text-sm text-slate-400 underline-offset-4 transition hover:text-white hover:underline"
        >
          {t("termsLink")}
        </a>
      </div>
    </SettingsCard>
  );
}
