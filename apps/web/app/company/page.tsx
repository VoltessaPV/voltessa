import type { Metadata } from "next";

import { LegalPageShell } from "@/components/legal/LegalPageShell";
import { COMPANY } from "@/lib/legal/company";
import { getLocale } from "@/lib/i18n/locale";

export const metadata: Metadata = {
  title: "Company Information",
};

const LAST_UPDATED = "31 July 2026";

const LABELS = {
  en: {
    legalName: "Legal name",
    tradingName: "Trading as",
    registrationNumber: "Company registration number (EIK)",
    registeredAddress: "Registered address",
    privacyEmail: "Privacy contact",
    supportEmail: "Support contact",
    website: "Website",
    governingLaw: "Governing law",
    supervisoryAuthority: "Data protection supervisory authority",
    intro: "Voltessa is operated by the legal entity below. This page is provided for transparency, in line with Bulgarian and EU disclosure requirements for online services.",
  },
  bg: {
    legalName: "Юридическо наименование",
    tradingName: "Търгува като",
    registrationNumber: "ЕИК",
    registeredAddress: "Седалище и адрес на управление",
    privacyEmail: "Контакт за поверителност",
    supportEmail: "Контакт за поддръжка",
    website: "Уебсайт",
    governingLaw: "Приложимо право",
    supervisoryAuthority: "Надзорен орган за защита на данните",
    intro: "Voltessa се управлява от юридическото лице по-долу. Тази страница се предоставя с цел прозрачност, в съответствие с българските и европейските изисквания за оповестяване за онлайн услуги.",
  },
} as const;

export default async function CompanyInformationPage() {
  const locale = await getLocale();
  const t = LABELS[locale];

  const rows: { label: string; value: string }[] = [
    { label: t.legalName, value: COMPANY.legalName },
    { label: t.tradingName, value: COMPANY.tradingName },
    { label: t.registrationNumber, value: COMPANY.registrationNumber },
    {
      label: t.registeredAddress,
      value: `${COMPANY.registeredAddress.street}, ${COMPANY.registeredAddress.postalCode} ${COMPANY.registeredAddress.city}, ${COMPANY.registeredAddress.country}`,
    },
    { label: t.privacyEmail, value: COMPANY.privacyEmail },
    { label: t.supportEmail, value: COMPANY.supportEmail },
    { label: t.website, value: COMPANY.websiteUrl },
    { label: t.governingLaw, value: COMPANY.governingLaw },
    {
      label: t.supervisoryAuthority,
      value: `${locale === "bg" ? COMPANY.supervisoryAuthority.nameBg : COMPANY.supervisoryAuthority.name} (${COMPANY.supervisoryAuthority.abbreviation}) — ${COMPANY.supervisoryAuthority.url}`,
    },
  ];

  return (
    <LegalPageShell
      locale={locale}
      title={{ en: "Company Information", bg: "Информация за дружеството" }}
      lastUpdated={LAST_UPDATED}
    >
      <section>
        <p>{t.intro}</p>

        <dl className="mt-6 divide-y divide-white/10 rounded-xl border border-white/10 bg-white/[0.02]">
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-1 gap-1 px-5 py-4 sm:grid-cols-3 sm:gap-4">
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 sm:col-span-1">{row.label}</dt>
              <dd className="text-sm text-slate-200 sm:col-span-2">{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </LegalPageShell>
  );
}
