import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

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

  applicationName: "Voltessa",

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

  creator: "Voltessa",

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}