import type { ReactNode } from "react";

import Footer from "@/components/layout/Footer";
import Navbar from "@/components/layout/Navbar";
import { CTAProvider } from "@/components/providers/CTAProvider";
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
    // Navbar renders a "Contact" link (`ContactNavLink`) that calls
    // `useCTA()`, which throws outside a `CTAProvider` — verified as a real
    // production crash on this milestone's preview deployment
    // (`Error: useCTA must be used within a CTAProvider`, every /privacy,
    // /terms, /cookie-policy, /company request). Hero.tsx (the marketing
    // homepage) already wraps Navbar the same way; this mirrors that.
    <CTAProvider>
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
    </CTAProvider>
  );
}
