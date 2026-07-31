import type { Metadata } from "next";

import { LegalPageShell } from "@/components/legal/LegalPageShell";
import { routes } from "@/lib/routes";
import { DATA_RETENTION_SCHEDULE } from "@/lib/legal/data-retention";
import { PRIVACY_POLICY_SECTIONS } from "@/lib/legal/content/privacy-policy";
import { SUB_PROCESSORS } from "@/lib/legal/sub-processors";
import { getLocale } from "@/lib/i18n/locale";

export const metadata: Metadata = {
  title: "Privacy Policy",
};

const LAST_UPDATED = "31 July 2026";

const LABELS = {
  en: {
    title: "Privacy Policy",
    retentionHeading: "How long we keep your data",
    retentionCategory: "Data category",
    retentionPeriod: "Retention period",
    retentionBasis: "Legal basis",
    retentionFooter: "See our full Data Retention Policy for the complete schedule and rationale.",
    subProcessorsHeading: "Who we share your data with",
    subProcessorsIntro: "We use the following providers to operate Voltessa. Each is contractually bound to process data only as we instruct.",
    transfersHeading: "International transfers",
    transfersBody:
      "Some of the providers listed above may process data outside Bulgaria. Where that happens, the transfer is covered by the safeguards required under Chapter V of the GDPR (such as Standard Contractual Clauses or an applicable adequacy decision), as provided in our agreement with that provider.",
    cookiePolicyLink: "Read our full Cookie Policy",
  },
  bg: {
    title: "Политика за поверителност",
    retentionHeading: "Колко дълго съхраняваме вашите данни",
    retentionCategory: "Категория данни",
    retentionPeriod: "Срок на съхранение",
    retentionBasis: "Правно основание",
    retentionFooter: "Вижте пълната ни Политика за съхранение на данни за пълния график и обосновката.",
    subProcessorsHeading: "С кого споделяме вашите данни",
    subProcessorsIntro: "Използваме следните доставчици, за да управляваме Voltessa. Всеки от тях е договорно обвързан да обработва данни само по наши указания.",
    transfersHeading: "Международни трансфери",
    transfersBody:
      "Някои от изброените по-горе доставчици може да обработват данни извън България. Когато това се случва, трансферът е обхванат от гаранциите, изисквани съгласно Глава V от ОРЗД (като Стандартни договорни клаузи или приложимо решение за адекватност), съгласно споразумението ни с този доставчик.",
    cookiePolicyLink: "Прочетете пълната ни Политика за бисквитки",
  },
} as const;

/** Split points so the retention table / sub-processor list / transfers section render right after "Cookies" and before "Your rights", not tacked on after "Contact". */
const BEFORE_DYNAMIC_SECTIONS = ["who-we-are", "data-we-collect", "why-we-process", "cookies"];

function renderSection(
  section: (typeof PRIVACY_POLICY_SECTIONS)[number],
  locale: "en" | "bg",
  t: (typeof LABELS)[keyof typeof LABELS],
) {
  return (
    <section key={section.id}>
      <h2 className="text-2xl font-semibold text-white">{section.heading[locale]}</h2>

      {section.paragraphs.map((paragraph, index) => (
        <p key={index} className="mt-4">
          {paragraph[locale]}
        </p>
      ))}

      {section.id === "cookies" && (
        <p className="mt-4">
          <a href={routes.cookiePolicy} className="text-blue-400 underline-offset-4 hover:text-blue-300 hover:underline">
            {t.cookiePolicyLink}
          </a>
        </p>
      )}
    </section>
  );
}

export default async function PrivacyPage() {
  const locale = await getLocale();
  const t = LABELS[locale];

  const beforeDynamic = PRIVACY_POLICY_SECTIONS.filter((section) => BEFORE_DYNAMIC_SECTIONS.includes(section.id));
  const afterDynamic = PRIVACY_POLICY_SECTIONS.filter((section) => !BEFORE_DYNAMIC_SECTIONS.includes(section.id));

  return (
    <LegalPageShell
      locale={locale}
      title={{ en: "Privacy Policy", bg: "Политика за поверителност" }}
      lastUpdated={LAST_UPDATED}
    >
      {beforeDynamic.map((section) => renderSection(section, locale, t))}

      <section>
        <h2 className="text-2xl font-semibold text-white">{t.retentionHeading}</h2>

        <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.02] text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3 font-medium">{t.retentionCategory}</th>
                <th className="px-4 py-3 font-medium">{t.retentionPeriod}</th>
                <th className="px-4 py-3 font-medium">{t.retentionBasis}</th>
              </tr>
            </thead>

            <tbody>
              {DATA_RETENTION_SCHEDULE.map((entry) => (
                <tr key={entry.id} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-3 align-top text-slate-200">{entry.category[locale]}</td>
                  <td className="px-4 py-3 align-top text-slate-400">{entry.retention[locale]}</td>
                  <td className="px-4 py-3 align-top text-slate-400">{entry.basis[locale]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-sm text-slate-400">{t.retentionFooter}</p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-white">{t.subProcessorsHeading}</h2>

        <p className="mt-4">{t.subProcessorsIntro}</p>

        <ul className="mt-4 space-y-3">
          {SUB_PROCESSORS.map((processor) => (
            <li key={processor.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <p className="text-sm font-medium text-white">{processor.name}</p>
              <p className="mt-1 text-xs text-slate-400">{processor.purpose[locale]}</p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-white">{t.transfersHeading}</h2>
        <p className="mt-4">{t.transfersBody}</p>
      </section>

      {afterDynamic.map((section) => renderSection(section, locale, t))}
    </LegalPageShell>
  );
}
