import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import type { getTranslations as GetTranslationsType } from "next-intl/server";

import { LegalPageShell } from "@/components/legal/LegalPageShell";
import { Link } from "@/lib/i18n/navigation";
import { buildLegalPageMetadata } from "@/lib/i18n/legal-page-metadata";
import type { AppLocale } from "@/lib/i18n/routing";
import { DATA_RETENTION_SCHEDULE } from "@/lib/legal/data-retention";
import { SUB_PROCESSORS } from "@/lib/legal/sub-processors";
import { routes } from "@/lib/routes";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return buildLegalPageMetadata(locale, "/privacy", "Privacy Policy");
}

type SectionTranslator = Awaited<ReturnType<typeof GetTranslationsType>>;

/** Split points so the retention table / sub-processor list / transfers section render right after "Cookies" and before "Your rights", not tacked on after "Contact". */
const BEFORE_DYNAMIC_SECTIONS = ["whoWeAre", "dataWeCollect", "whyWeProcess", "cookies"] as const;
const AFTER_DYNAMIC_SECTIONS = [
  "yourRights",
  "deletingYourAccount",
  "dataSecurity",
  "childrensPrivacy",
  "changes",
  "contact",
] as const;

function renderSection(t: SectionTranslator, key: string, cookiePolicyLabel: string) {
  const paragraphs = t.raw(`sections.${key}.paragraphs`) as string[];

  return (
    <section key={key}>
      <h2 className="text-2xl font-semibold text-white">{t(`sections.${key}.heading`)}</h2>

      {paragraphs.map((paragraph, index) => (
        <p key={index} className="mt-4">
          {paragraph}
        </p>
      ))}

      {key === "cookies" && (
        <p className="mt-4">
          <Link
            href={routes.cookiePolicy}
            className="text-blue-400 underline-offset-4 hover:text-blue-300 hover:underline"
          >
            {cookiePolicyLabel}
          </Link>
        </p>
      )}
    </section>
  );
}

export default async function PrivacyPage() {
  const [t, locale] = await Promise.all([
    getTranslations("legal.privacyPolicy"),
    getLocale(),
  ]);
  const appLocale = locale as AppLocale;
  const cookiePolicyLabel = t("cookiePolicyLink");

  return (
    <LegalPageShell title={t("pageTitle")} lastUpdated={t("lastUpdated")}>
      {BEFORE_DYNAMIC_SECTIONS.map((key) => renderSection(t, key, cookiePolicyLabel))}

      <section>
        <h2 className="text-2xl font-semibold text-white">{t("retention.heading")}</h2>

        <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.02] text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3 font-medium">{t("retention.categoryColumn")}</th>
                <th className="px-4 py-3 font-medium">{t("retention.periodColumn")}</th>
                <th className="px-4 py-3 font-medium">{t("retention.basisColumn")}</th>
              </tr>
            </thead>

            <tbody>
              {DATA_RETENTION_SCHEDULE.map((entry) => (
                <tr key={entry.id} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-3 align-top text-slate-200">{entry.category[appLocale]}</td>
                  <td className="px-4 py-3 align-top text-slate-400">{entry.retention[appLocale]}</td>
                  <td className="px-4 py-3 align-top text-slate-400">{entry.basis[appLocale]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-sm text-slate-400">{t("retention.footer")}</p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-white">{t("subProcessors.heading")}</h2>

        <p className="mt-4">{t("subProcessors.intro")}</p>

        <ul className="mt-4 space-y-3">
          {SUB_PROCESSORS.map((processor) => (
            <li key={processor.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <p className="text-sm font-medium text-white">{processor.name}</p>
              <p className="mt-1 text-xs text-slate-400">{processor.purpose[appLocale]}</p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-white">{t("transfers.heading")}</h2>
        <p className="mt-4">{t("transfers.body")}</p>
      </section>

      {AFTER_DYNAMIC_SECTIONS.map((key) => renderSection(t, key, cookiePolicyLabel))}
    </LegalPageShell>
  );
}
