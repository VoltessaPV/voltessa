import { hasLocale } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RootProviders } from "@/components/layout/RootProviders";
import { geistMono, geistSans } from "@/lib/fonts";
import { APP_NAME } from "@/lib/constants";
import { buildCanonicalUrl, buildLanguageAlternates } from "@/lib/i18n/seo";
import { routing, type AppLocale } from "@/lib/i18n/routing";

import "../globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

type LocaleLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

/**
 * Locale-aware metadata for the root of the localized tree — title/
 * description come from `marketing.meta` (translated), `alternates` carries
 * `hreflang` (one entry per active locale, from `routing.locales`, plus
 * `x-default` -> English) and a self-canonical (never canonicalizing back to
 * English — each locale is genuinely distinct content). Individual pages
 * (e.g. the four legal pages) provide their own more specific
 * `generateMetadata` for their own path; Next.js merges page-level metadata
 * over this root.
 */
export async function generateMetadata({ params }: LocaleLayoutProps): Promise<Metadata> {
  const { locale } = await params;
  const appLocale = (hasLocale(routing.locales, locale) ? locale : routing.defaultLocale) as AppLocale;
  const t = await getTranslations({ locale: appLocale, namespace: "marketing.meta" });

  return {
    metadataBase: new URL("https://voltessa.ai"),

    title: {
      default: t("title"),
      template: `%s | ${t("title")}`,
    },

    description: t("description"),

    applicationName: APP_NAME,

    keywords: [
      "Solar",
      "BESS",
      "Battery Storage",
      "AI",
      "Energy",
      "Renewables",
      "Huawei",
      "FusionSolar",
      "Energy Trading",
    ],

    authors: [{ name: "Voltessa" }],

    creator: APP_NAME,

    alternates: {
      canonical: buildCanonicalUrl(appLocale, ""),
      languages: buildLanguageAlternates(""),
    },

    openGraph: {
      title: t("title"),
      description: t("description"),
      url: buildCanonicalUrl(appLocale, ""),
      siteName: "Voltessa",
      locale: appLocale === "bg" ? "bg_BG" : "en_US",
      type: "website",
    },

    robots: {
      index: true,
      follow: true,
    },
  };
}

/**
 * The root layout for every customer-facing, localized route — the one
 * place `<html>`/`<body>` are declared for this part of the app. `/admin`
 * and `/dev` are separate sibling roots (`app/admin/layout.tsx`,
 * `app/dev/layout.tsx`) with their own `<html>`/`<body>`, pinned to English
 * — Next.js supports multiple top-level root layouts as long as they don't
 * share a parent layout above them, which is exactly this structure.
 */
export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <RootProviders locale={locale as AppLocale} messages={messages}>
          {children}
        </RootProviders>
      </body>
    </html>
  );
}
