"use client";

import type { ReactNode } from "react";

import { useConsent } from "./ConsentProvider";

type CookieSettingsLinkProps = {
  className?: string;
  children: ReactNode;
};

/**
 * The persistent "Cookie Settings" entry required sitewide (footer, the
 * authenticated Settings page, and the Calendly consent placeholder below)
 * — reopens the same preferences modal `CookieBanner`'s "Customize" opens,
 * pre-filled with the current saved choices (see `CookiePreferencesModal`).
 * A plain `<button>`, not a link: it doesn't navigate anywhere, it opens a
 * dialog on the current page.
 */
export function CookieSettingsLink({ className, children }: CookieSettingsLinkProps) {
  const { openPreferences } = useConsent();

  return (
    <button type="button" onClick={openPreferences} className={className}>
      {children}
    </button>
  );
}
