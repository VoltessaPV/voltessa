import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { LegalPageShell } from "@/components/legal/LegalPageShell";
import { buildLegalPageMetadata } from "@/lib/i18n/legal-page-metadata";
import { COMPANY } from "@/lib/legal/company";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return buildLegalPageMetadata(locale, "/company", "Company Information");
}

export default async function CompanyInformationPage() {
  const [t, locale] = await Promise.all([
    getTranslations("legal.companyInformation"),
    getLocale(),
  ]);

  const rows: { label: string; value: string }[] = [
    { label: t("fields.legalName"), value: COMPANY.legalName },
    { label: t("fields.tradingName"), value: COMPANY.tradingName },
    { label: t("fields.registrationNumber"), value: COMPANY.registrationNumber },
    {
      label: t("fields.registeredAddress"),
      value: `${COMPANY.registeredAddress.street}, ${COMPANY.registeredAddress.postalCode} ${COMPANY.registeredAddress.city}, ${COMPANY.registeredAddress.country}`,
    },
    { label: t("fields.privacyEmail"), value: COMPANY.privacyEmail },
    { label: t("fields.supportEmail"), value: COMPANY.supportEmail },
    { label: t("fields.website"), value: COMPANY.websiteUrl },
    { label: t("fields.governingLaw"), value: COMPANY.governingLaw },
    {
      label: t("fields.supervisoryAuthority"),
      value: `${locale === "bg" ? COMPANY.supervisoryAuthority.nameBg : COMPANY.supervisoryAuthority.name} (${COMPANY.supervisoryAuthority.abbreviation}) — ${COMPANY.supervisoryAuthority.url}`,
    },
  ];

  return (
    <LegalPageShell title={t("pageTitle")} lastUpdated={t("lastUpdated")}>
      <section>
        <p>{t("intro")}</p>

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
