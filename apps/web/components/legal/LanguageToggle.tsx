"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { setLocale } from "@/lib/consent/actions";
import type { Locale } from "@/lib/i18n/locale";

const LOCALES: Locale[] = ["en", "bg"];

/**
 * Scoped to the compliance surfaces (legal pages, consent banner/modal) —
 * see `lib/i18n/locale.ts`'s own comment for why this isn't a sitewide
 * language switcher. Same `useTransition` + Server Action + `router.refresh()`
 * shape already established by `HuaweiControlCard`/`RefreshButton` for every
 * other "write, then reflect the new server state" interaction in this app.
 */
export function LanguageToggle({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleSelect(next: Locale) {
    if (next === locale || isPending) {
      return;
    }

    startTransition(async () => {
      await setLocale(next);
      router.refresh();
    });
  }

  return (
    <div
      role="group"
      aria-label="Language"
      className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-1 text-xs"
    >
      {LOCALES.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => handleSelect(code)}
          aria-pressed={locale === code}
          disabled={isPending}
          className={`rounded-md px-2.5 py-1 font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
            locale === code
              ? "bg-white/10 text-white"
              : "text-slate-400 hover:text-white"
          }`}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
