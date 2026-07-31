import type { Metadata } from "next";

import { LegalPageShell } from "@/components/legal/LegalPageShell";
import { TERMS_SECTIONS } from "@/lib/legal/content/terms";
import { getLocale } from "@/lib/i18n/locale";

export const metadata: Metadata = {
  title: "Terms of Service",
};

const LAST_UPDATED = "31 July 2026";

export default async function TermsPage() {
  const locale = await getLocale();

  return (
    <LegalPageShell
      locale={locale}
      title={{ en: "Terms of Service", bg: "Общи условия" }}
      lastUpdated={LAST_UPDATED}
    >
      {TERMS_SECTIONS.map((section) => (
        <section key={section.id}>
          <h2 className="text-2xl font-semibold text-white">{section.heading[locale]}</h2>

          {section.paragraphs.map((paragraph, index) => (
            <p key={index} className="mt-4">
              {paragraph[locale]}
            </p>
          ))}
        </section>
      ))}
    </LegalPageShell>
  );
}
