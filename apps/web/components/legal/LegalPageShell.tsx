import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import Footer from "@/components/layout/Footer";
import Navbar from "@/components/layout/Navbar";
import { CTAProvider } from "@/components/providers/CTAProvider";

type LegalPageShellProps = {
  title: string;
  lastUpdated: string;
  children: ReactNode;
};

/**
 * Shared chrome for every compliance page (Privacy Policy, Cookie Policy,
 * Terms of Service, Company Information). `title`/`lastUpdated` are already
 * resolved strings (from the calling page's own `useTranslations()` call) —
 * this shell doesn't know or care which locale it's rendering, since
 * `LanguageSwitcher` reads that from next-intl's own context. Full
 * Internationalization milestone: replaces the GDPR milestone's scoped
 * `LanguageToggle` (retired) with the sitewide `LanguageSwitcher`.
 *
 * Navbar renders a "Contact" link (`ContactNavLink`) that calls `useCTA()`,
 * which throws outside a `CTAProvider` — a real production incident during
 * the GDPR milestone. Hero.tsx (the marketing homepage) already wraps
 * Navbar the same way; this mirrors that.
 */
export function LegalPageShell({ title, lastUpdated, children }: LegalPageShellProps) {
  const t = useTranslations("legal.shell");

  return (
    <CTAProvider>
      <Navbar />

      <main className="mx-auto max-w-4xl px-4 pb-16 pt-28 text-slate-200 sm:px-8 sm:pb-24 sm:pt-32">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-4xl font-bold text-white">{title}</h1>

          <LanguageSwitcher />
        </div>

        <p className="mt-4 text-sm text-slate-400">
          {t("lastUpdatedLabel")}: {lastUpdated}
        </p>

        <div className="mt-12 space-y-10 leading-8 text-slate-300">
          {children}
        </div>
      </main>

      <Footer />
    </CTAProvider>
  );
}
