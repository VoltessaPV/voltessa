"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";

import { useConsent } from "./ConsentProvider";

type CategoryToggleProps = {
  id: string;
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  alwaysOnLabel?: string;
  onChange?: (checked: boolean) => void;
};

function CategoryToggle({ id, title, description, checked, disabled, alwaysOnLabel, onChange }: CategoryToggleProps) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-white">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">{description}</p>
      </div>

      {disabled ? (
        <span className="mt-0.5 shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-slate-400">
          {alwaysOnLabel}
        </span>
      ) : (
        <label htmlFor={id} className="relative mt-0.5 inline-flex shrink-0 cursor-pointer items-center">
          <input
            id={id}
            type="checkbox"
            role="switch"
            aria-checked={checked}
            checked={checked}
            onChange={(event) => onChange?.(event.target.checked)}
            className="peer sr-only"
          />
          <span className="h-6 w-11 rounded-full bg-white/10 transition peer-checked:bg-blue-600" />
          <span className="pointer-events-none absolute left-1 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-5" />
        </label>
      )}
    </div>
  );
}

/**
 * Cookie Settings preferences modal — reachable from the first-visit
 * banner's "Customize", and from the footer's persistent "Cookie Settings"
 * link at any later time (`useConsent().openPreferences()`). A true modal
 * dialog (`aria-modal="true"`, focus-trapped, Escape closes it) unlike the
 * non-modal banner, since it fully occupies the interaction until dismissed.
 * Local toggle state seeds from the current saved `consent` every time the
 * modal opens (not just once on mount), so reopening it after a save always
 * shows what's actually in effect.
 */
export function CookiePreferencesModal() {
  const { isModalOpen, closeModal, acceptAll, rejectAll, saveCustom, consent, isPending } = useConsent();
  const t = useTranslations("cookie-consent.modal");

  const [functional, setFunctional] = useState(consent?.functional ?? false);
  const [analytics, setAnalytics] = useState(consent?.analytics ?? false);
  const [marketing, setMarketing] = useState(consent?.marketing ?? false);

  useEffect(() => {
    if (isModalOpen) {
      setFunctional(consent?.functional ?? false);
      setAnalytics(consent?.analytics ?? false);
      setMarketing(consent?.marketing ?? false);
    }
  }, [isModalOpen, consent]);

  useBodyScrollLock(isModalOpen);
  const containerRef = useFocusTrap(isModalOpen);

  useEffect(() => {
    if (!isModalOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeModal();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isModalOpen, closeModal]);

  if (!isModalOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/70" onClick={closeModal} aria-hidden="true" />

      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cookie-preferences-title"
        aria-describedby="cookie-preferences-description"
        className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-[#050816] shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)] sm:max-h-[80vh] sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 p-5">
          <div>
            <h2 id="cookie-preferences-title" className="text-lg font-semibold text-white">
              {t("title")}
            </h2>

            <p id="cookie-preferences-description" className="mt-1 text-xs text-slate-400">
              {t("description")}
            </p>
          </div>

          <button
            type="button"
            onClick={closeModal}
            aria-label={t("closeButton")}
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-white/5 hover:text-white"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          <CategoryToggle
            id="cookie-category-necessary"
            title={t("categories.necessary.title")}
            description={t("categories.necessary.description")}
            checked
            disabled
            alwaysOnLabel={t("categories.necessary.alwaysOnBadge")}
          />

          <CategoryToggle
            id="cookie-category-functional"
            title={t("categories.functional.title")}
            description={t("categories.functional.description")}
            checked={functional}
            onChange={setFunctional}
          />

          <CategoryToggle
            id="cookie-category-analytics"
            title={t("categories.analytics.title")}
            description={t("categories.analytics.description")}
            checked={analytics}
            onChange={setAnalytics}
          />

          <CategoryToggle
            id="cookie-category-marketing"
            title={t("categories.marketing.title")}
            description={t("categories.marketing.description")}
            checked={marketing}
            onChange={setMarketing}
          />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-white/10 p-5">
          <button
            type="button"
            onClick={rejectAll}
            disabled={isPending}
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("rejectAllButton")}
          </button>

          <button
            type="button"
            onClick={acceptAll}
            disabled={isPending}
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("acceptAllButton")}
          </button>

          <button
            type="button"
            onClick={() => saveCustom({ functional, analytics, marketing })}
            disabled={isPending}
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("saveButton")}
          </button>
        </div>
      </div>
    </div>
  );
}
