import type { Metadata } from "next";

import { CookieSettingsLink } from "@/components/consent/CookieSettingsLink";
import { LegalPageShell } from "@/components/legal/LegalPageShell";
import { getConsentDictionary } from "@/lib/consent/dictionary";
import { getCookiesByCategory } from "@/lib/consent/cookie-registry";
import type { ConsentCategory } from "@/lib/consent/types";
import { getLocale } from "@/lib/i18n/locale";

export const metadata: Metadata = {
  title: "Cookie Policy",
};

const LAST_UPDATED = "31 July 2026";

const CATEGORY_ORDER: ConsentCategory[] = ["necessary", "functional", "analytics", "marketing"];

const LABELS = {
  en: {
    intro1:
      "This Cookie Policy explains every cookie Voltessa actually sets — what it does, who sets it, and how long it lasts — and how to change your choice at any time. It should be read together with our Privacy Policy.",
    intro2:
      "\"Strictly Necessary\" cookies don't require your consent and can't be switched off, because Voltessa can't function without them. Everything else is off by default and only set if you consent to it.",
    manageHeading: "Manage your preferences",
    manageBody: "You can change your cookie choices at any time — this opens the same preferences panel shown on your first visit.",
    manageButton: "Open Cookie Settings",
    tableCookie: "Cookie",
    tableProvider: "Set by",
    tablePurpose: "Purpose",
    tableDuration: "Duration",
    noneToday: "No cookies in this category are set today.",
  },
  bg: {
    intro1:
      "Тази Политика за бисквитки обяснява всяка бисквитка, която Voltessa действително задава — какво прави, кой я задава и колко дълго трае — и как да промените избора си по всяко време. Тя трябва да се чете заедно с нашата Политика за поверителност.",
    intro2:
      "„Строго необходимите\" бисквитки не изискват вашето съгласие и не могат да бъдат изключени, защото Voltessa не може да функционира без тях. Всичко останало е изключено по подразбиране и се задава само ако дадете съгласие.",
    manageHeading: "Управлявайте предпочитанията си",
    manageBody: "Можете да промените избора си за бисквитки по всяко време — това отваря същия панел с предпочитания, показан при първото ви посещение.",
    manageButton: "Отвори настройки за бисквитки",
    tableCookie: "Бисквитка",
    tableProvider: "Задава се от",
    tablePurpose: "Предназначение",
    tableDuration: "Продължителност",
    noneToday: "Днес не се задават бисквитки от тази категория.",
  },
} as const;

export default async function CookiePolicyPage() {
  const locale = await getLocale();
  const t = LABELS[locale];
  const categoryDict = getConsentDictionary(locale).modal.categories;

  return (
    <LegalPageShell
      locale={locale}
      title={{ en: "Cookie Policy", bg: "Политика за бисквитки" }}
      lastUpdated={LAST_UPDATED}
    >
      <section>
        <p>{t.intro1}</p>
        <p className="mt-4">{t.intro2}</p>
      </section>

      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="text-lg font-semibold text-white">{t.manageHeading}</h2>
        <p className="mt-2 text-sm text-slate-400">{t.manageBody}</p>

        <CookieSettingsLink className="mt-4 inline-block rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500">
          {t.manageButton}
        </CookieSettingsLink>
      </section>

      {CATEGORY_ORDER.map((category) => {
        const entries = getCookiesByCategory(category);
        const categoryLabel = categoryDict[category];

        return (
          <section key={category}>
            <h2 className="text-2xl font-semibold text-white">{categoryLabel.title}</h2>
            <p className="mt-2 text-sm text-slate-400">{categoryLabel.description}</p>

            {entries.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">{t.noneToday}</p>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/[0.02] text-xs uppercase tracking-wide text-slate-400">
                      <th className="px-4 py-3 font-medium">{t.tableCookie}</th>
                      <th className="px-4 py-3 font-medium">{t.tableProvider}</th>
                      <th className="px-4 py-3 font-medium">{t.tablePurpose}</th>
                      <th className="px-4 py-3 font-medium">{t.tableDuration}</th>
                    </tr>
                  </thead>

                  <tbody>
                    {entries.map((entry) => (
                      <tr key={entry.id} className="border-b border-white/5 last:border-0">
                        <td className="px-4 py-3 align-top font-mono text-xs text-slate-200">{entry.name}</td>
                        <td className="px-4 py-3 align-top text-slate-400">{entry.provider}</td>
                        <td className="px-4 py-3 align-top text-slate-400">{entry.purpose[locale]}</td>
                        <td className="px-4 py-3 align-top text-slate-400">{entry.duration[locale]}</td>
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
