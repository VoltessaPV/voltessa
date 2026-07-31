import type { ReactNode } from "react";

import Footer from "@/components/layout/Footer";
import Navbar from "@/components/layout/Navbar";
import type { Locale } from "@/lib/i18n/locale";

import { LanguageToggle } from "./LanguageToggle";

const LAST_UPDATED_LABEL: Record<Locale, string> = {
  en: "Last updated",
  bg: "Последна актуализация",
};

type LegalPageShellProps = {
  locale: Locale;
  title: { en: string; bg: string };
  lastUpdated: string;
  children: ReactNode;
};

/**
 * Shared chrome for every compliance page (Privacy Policy, Cookie Policy,
 * Terms of Service, Company Information) — GDPR + Cookie Consent Platform
 * milestone. Before this milestone, `/privacy` and `/terms` rendered a bare
 * `<main>` with no Navbar/Footer at all (verified: neither page imported
 * either), meaning they were unreachable from any in-page navigation and
 * had no path to a "Cookie Settings" entry. This wrapper fixes that for all
 * four compliance pages at once, in one place, rather than four times.
 */
export function LegalPageShell({ locale, title, lastUpdated, children }: LegalPageShellProps) {
  return (
    <>
      <Navbar />

      <main className="mx-auto max-w-4xl px-4 pb-16 pt-28 text-slate-200 sm:px-8 sm:pb-24 sm:pt-32">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-4xl font-bold text-white">{title[locale]}</h1>

          <LanguageToggle locale={locale} />
        </div>

        <p className="mt-4 text-sm text-slate-400">
          {LAST_UPDATED_LABEL[locale]}: {lastUpdated}
        </p>

        <div className="mt-12 space-y-10 leading-8 text-slate-300">
          {children}
        </div>
      </main>

      <Footer />
    </>
  );
}
