import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { CookieSettingsLink } from "@/components/consent/CookieSettingsLink";
import { LegalPageShell } from "@/components/legal/LegalPageShell";
import { getCookiesByCategory } from "@/lib/consent/cookie-registry";
import type { ConsentCategory } from "@/lib/consent/types";
import { buildLegalPageMetadata } from "@/lib/i18n/legal-page-metadata";
import type { AppLocale } from "@/lib/i18n/routing";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return buildLegalPageMetadata(locale, "/cookie-policy", "Cookie Policy");
}

const CATEGORY_ORDER: ConsentCategory[] = ["necessary", "functional", "analytics", "marketing"];

export default async function CookiePolicyPage() {
  const [t, categoryT, locale] = await Promise.all([
    getTranslations("legal.cookiePolicy"),
    getTranslations("cookie-consent.modal.categories"),
    getLocale(),
  ]);
  const appLocale = locale as AppLocale;

  return (
    <LegalPageShell title={t("pageTitle")} lastUpdated={t("lastUpdated")}>
      <section>
        <p>{t("intro1")}</p>
        <p className="mt-4">{t("intro2")}</p>
      </section>

      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="text-lg font-semibold text-white">{t("manage.heading")}</h2>
        <p className="mt-2 text-sm text-slate-400">{t("manage.body")}</p>

        <CookieSettingsLink className="mt-4 inline-block rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500">
          {t("manage.button")}
        </CookieSettingsLink>
      </section>

      {CATEGORY_ORDER.map((category) => {
        const entries = getCookiesByCategory(category);

        return (
          <section key={category}>
            <h2 className="text-2xl font-semibold text-white">{categoryT(`${category}.title`)}</h2>
            <p className="mt-2 text-sm text-slate-400">{categoryT(`${category}.description`)}</p>

            {entries.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">{t("table.noneToday")}</p>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/[0.02] text-xs uppercase tracking-wide text-slate-400">
                      <th className="px-4 py-3 font-medium">{t("table.cookieColumn")}</th>
                      <th className="px-4 py-3 font-medium">{t("table.providerColumn")}</th>
                      <th className="px-4 py-3 font-medium">{t("table.purposeColumn")}</th>
                      <th className="px-4 py-3 font-medium">{t("table.durationColumn")}</th>
                    </tr>
                  </thead>

                  <tbody>
                    {entries.map((entry) => (
                      <tr key={entry.id} className="border-b border-white/5 last:border-0">
                        <td className="px-4 py-3 align-top font-mono text-xs text-slate-200">{entry.name}</td>
                        <td className="px-4 py-3 align-top text-slate-400">{entry.provider}</td>
                        <td className="px-4 py-3 align-top text-slate-400">{entry.purpose[appLocale]}</td>
                        <td className="px-4 py-3 align-top text-slate-400">{entry.duration[appLocale]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </LegalPageShell>
  );
}
