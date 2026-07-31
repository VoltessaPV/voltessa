"use client";

import { useLocale } from "next-intl";
import { useTransition } from "react";

import { setLocale } from "@/lib/i18n/actions";
import { usePathname, useRouter } from "@/lib/i18n/navigation";
import { routing, type AppLocale } from "@/lib/i18n/routing";

/**
 * Each language's name is shown in itself (English, Български), not
 * translated per the current UI locale — the standard convention for a
 * language switcher (a Bulgarian reader still recognizes "English", but a
 * translated label defeats the point of the control).
 */
const NATIVE_NAMES: Record<AppLocale, string> = {
  en: "English",
  bg: "Български",
};

/**
 * The single global language switcher — used identically in the marketing
 * Navbar, the authenticated platform chrome (AppHeader/AppSidebar), and the
 * legal pages, replacing the GDPR milestone's scoped `LanguageToggle`
 * (`components/legal/LanguageToggle.tsx`, retired — see the legal/
 * cookie-consent migration). `usePathname()`/`useRouter()` here are the
 * locale-aware versions from `lib/i18n/navigation.ts`, not `next/navigation`
 * — `router.replace(pathname, { locale })` is next-intl's own built-in
 * mechanism for "switch language, stay on the same page" (the explicit
 * requirement), never a redirect to home.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const currentLocale = useLocale() as AppLocale;
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleSelect(next: AppLocale) {
    if (next === currentLocale || isPending) {
      return;
    }

    startTransition(async () => {
      await setLocale(next);
      router.replace(pathname, { locale: next });
    });
  }

  return (
    <div
      role="group"
      aria-label="Language"
      className={
        className ??
        "inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-1 text-xs"
      }
    >
      {routing.locales.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => handleSelect(code)}
          aria-pressed={currentLocale === code}
          disabled={isPending}
          className={`rounded-md px-2.5 py-1 font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
            currentLocale === code
              ? "bg-white/10 text-white"
              : "text-slate-400 hover:text-white"
          }`}
        >
          {NATIVE_NAMES[code]}
        </button>
      ))}
    </div>
  );
}
