import type { Metadata } from "next";

import { RootProviders } from "@/components/layout/RootProviders";
import { geistMono, geistSans } from "@/lib/fonts";
import enMessages from "@/messages/en/index";

import "../globals.css";

export const metadata: Metadata = {
  title: "Voltessa (Internal)",
  robots: {
    index: false,
    follow: false,
  },
};

type DevRootLayoutProps = {
  children: React.ReactNode;
};

/**
 * Full Internationalization milestone. `app/dev/*` (internal diagnostic
 * consoles — FusionSolar Atlanta console, Huawei API console) is not
 * customer-facing and not admin either; excluded from localization for the
 * same underlying reason as `/admin` (a separate root layout, no `[locale]`
 * segment, English-pinned via `RootProviders`), just without `AppShell` —
 * these pages have never had platform chrome, they're standalone consoles.
 * Each page's own auth check (`requirePermission`) is unchanged.
 */
export default function DevRootLayout({ children }: DevRootLayoutProps) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <RootProviders locale="en" messages={enMessages}>
          {children}
        </RootProviders>
      </body>
    </html>
  );
}
