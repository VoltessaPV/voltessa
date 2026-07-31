import type { Metadata } from "next";

import { AppShell } from "@/components/platform/layout/AppShell";
import { RootProviders } from "@/components/layout/RootProviders";
import { geistMono, geistSans } from "@/lib/fonts";
import { requirePlatformAdmin } from "@/lib/auth/session";
import enMessages from "@/messages/en/index";

import "../globals.css";

export const metadata: Metadata = {
  title: {
    default: "Voltessa Admin",
    template: "%s | Voltessa Admin",
  },
  // Never indexed - an internal tool, not a customer-facing surface.
  robots: {
    index: false,
    follow: false,
  },
};

type AdminRootLayoutProps = {
  children: React.ReactNode;
};

/**
 * Full Internationalization milestone. Platform Admin is explicitly out of
 * scope for localization — this is now its own root layout (its own
 * `<html lang="en">`/`<body>`), a sibling of `app/[locale]/layout.tsx`
 * rather than nested inside it, so there is no `[locale]` URL segment for
 * admin at all (never `/en/admin/...` or `/bg/admin/...` — just `/admin/...`,
 * unconditionally). `RootProviders` is still used (for the consent
 * banner/cookie plumbing, which admin still needs), pinned to
 * `locale="en"` with only the English message tree — every shared
 * component underneath (AppShell/AppSidebar/AppHeader) keeps calling
 * `useTranslations()` exactly like the localized tree does; the
 * English-only constraint is enforced here, at this one boundary, not by
 * special-casing every component itself.
 *
 * Consolidates what used to be two layouts
 * (`app/(platform)/layout.tsx`'s `AppShell` wrapping +
 * `app/(platform)/admin/layout.tsx`'s `requirePlatformAdmin()` gate — defense
 * in depth still holds: every Server Action under `admin/actions.ts`
 * re-checks `requirePlatformAdmin()` itself too, since a layout render never
 * protects a Server Action's own RPC) into one, now that admin is physically
 * separate from the rest of the platform rather than nested inside its
 * parent layout.
 */
export default async function AdminRootLayout({ children }: AdminRootLayoutProps) {
  const admin = await requirePlatformAdmin();

  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <RootProviders locale="en" messages={enMessages}>
          <AppShell
            user={{
              name: admin.name,
              email: admin.email,
              role: admin.role,
              isPlatformAdmin: admin.isPlatformAdmin,
            }}
          >
            {children}
          </AppShell>
        </RootProviders>
      </body>
    </html>
  );
}
