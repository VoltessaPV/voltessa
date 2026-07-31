"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { useConsent } from "./ConsentProvider";

/**
 * First-visit consent banner. No dismiss-by-scrolling/close-X path exists —
 * the only ways to leave this state are the three explicit actions below,
 * per current EU guidance that continued browsing is not valid consent.
 * Reject All and Accept All are deliberately the same size/weight
 * (equal prominence) — Customize is a lower-emphasis third option, which is
 * the part EU enforcement has focused on (making refusal as easy to find as
 * acceptance), not a requirement that all three look identical.
 */
export function CookieBanner() {
  const { isBannerOpen, acceptAll, rejectAll, openPreferences, isPending } = useConsent();
  const [isVisible, setIsVisible] = useState(false);
  const t = useTranslations("cookie-consent.banner");

  useEffect(() => {
    if (!isBannerOpen) {
      setIsVisible(false);
      return;
    }

    const frame = requestAnimationFrame(() => setIsVisible(true));
    return () => cancelAnimationFrame(frame);
  }, [isBannerOpen]);

  if (!isBannerOpen) {
    return null;
  }

  return (
    <div
      role="region"
      aria-live="polite"
      aria-label={t("heading")}
      className={`fixed inset-x-0 bottom-0 z-[100] px-4 pb-4 transition-transform duration-300 ease-out motion-reduce:transition-none sm:px-6 sm:pb-6 ${
        isVisible ? "translate-y-0" : "translate-y-full"
      }`}
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-4 rounded-2xl border border-white/10 bg-[#050816] p-5 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)] sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <p className="text-sm font-semibold text-white">{t("heading")}</p>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-400 sm:max-w-xl">{t("body")}</p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={openPreferences}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-300 underline-offset-4 transition hover:text-white hover:underline"
          >
            {t("customizeButton")}
          </button>

          <button
            type="button"
            onClick={rejectAll}
            disabled={isPending}
            className="rounded-xl border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("rejectAllButton")}
          </button>

          <button
            type="button"
            onClick={acceptAll}
            disabled={isPending}
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("acceptAllButton")}
          </button>
        </div>
      </div>
    </div>
  );
}
