import { APP_NAME } from "@/lib/constants";
import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

import { CookieBanner } from "@/components/consent/CookieBanner";
import { CookiePreferencesModal } from "@/components/consent/CookiePreferencesModal";
import { ConsentProvider } from "@/components/consent/ConsentProvider";
import { getConsent } from "@/lib/consent/session";
import { getLocale } from "@/lib/i18n/locale";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://voltessa.ai"),

  title: {
    default: "Voltessa",
    template: "%s | Voltessa",
  },

  description:
    "AI platform for solar parks, battery storage and renewable energy operations.",

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

  authors: [
    {
      name: "Voltessa",
    },
  ],

  creator: APP_NAME,

  openGraph: {
    title: "Voltessa",
    description:
      "AI platform for solar parks, battery storage and renewable energy operations.",
    url: "https://voltessa.ai",
    siteName: "Voltessa",
    locale: "en_US",
    type: "website",
  },

  robots: {
    index: true,
    follow: true,
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [consent, locale] = await Promise.all([getConsent(), getLocale()]);

  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <ConsentProvider initialConsent={consent} locale={locale}>
          {children}
          <CookieBanner />
          <CookiePreferencesModal />
        </ConsentProvider>
      </body>
    </html>
  );
}