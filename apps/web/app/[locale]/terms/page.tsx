import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { LegalPageShell } from "@/components/legal/LegalPageShell";
import { buildLegalPageMetadata } from "@/lib/i18n/legal-page-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return buildLegalPageMetadata(locale, "/terms", "Terms of Service");
}

const SECTIONS = [
  "acceptance",
  "theService",
  "accounts",
  "yourResponsibilities",
  "fees",
  "accountDeletion",
  "liability",
  "governingLaw",
  "changes",
  "contact",
] as const;

export default async function TermsPage() {
  const t = await getTranslations("legal.termsOfService");

  return (
    <LegalPageShell title={t("pageTitle")} lastUpdated={t("lastUpdated")}>
      {SECTIONS.map((key) => {
        const paragraphs = t.raw(`sections.${key}.paragraphs`) as string[];

        return (
          <section key={key}>
            <h2 className="text-2xl font-semibold text-white">{t(`sections.${key}.heading`)}</h2>

            {paragraphs.map((paragraph, index) => (
              <p key={index} className="mt-4">
                {paragraph}
              </p>
            ))}
          </section>
        );
      })}
    </LegalPageShell>
  );
}
