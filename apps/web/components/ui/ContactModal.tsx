"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";

import { submitContactRequest } from "@/app/[locale]/(marketing)/actions";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";

import { buttonClassName } from "./Button";

const inputClassName =
  "w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/80 placeholder:text-white/30 focus:border-blue-500/50 focus:outline-none";

const labelClassName = "flex flex-col gap-1.5 text-sm text-slate-300";

type ContactModalProps = {
  open: boolean;
  onClose: () => void;
};

/**
 * The landing page's one shared "Talk to Us" contact form modal — rendered
 * once by CTAProvider, controlled via `open`/`onClose`. Same interaction
 * quality as CalendlyModal: closes via ESC, an overlay click, or the close
 * button; body scroll locked only while open via the same shared
 * useBodyScrollLock hook used there.
 */
export function ContactModal({ open, onClose }: ContactModalProps) {
  const t = useTranslations("marketing.contactModal");
  const tErrors = useTranslations("marketing.contactModal.errors");
  const [isPending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useBodyScrollLock(open);

  // Reset to a fresh form each time the modal is (re)opened.
  useEffect(() => {
    if (open) {
      setErrorCode(null);
      setSubmitted(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    setErrorCode(null);

    startTransition(async () => {
      const result = await submitContactRequest(formData);

      if (!result.ok) {
        setErrorCode(result.code);
        return;
      }

      setSubmitted(true);
    });
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#0B1020] p-6 shadow-2xl sm:p-8"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("ariaLabel")}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-xl font-semibold text-white">{t("title")}</h2>

          <button
            type="button"
            onClick={onClose}
            aria-label={t("closeLabel")}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/5 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {submitted ? (
          <div className="mt-8 py-6 text-center">
            <p className="text-lg font-medium text-white">{t("thankYouTitle")}</p>
            <p className="mt-2 text-sm text-slate-400">{t("thankYouDescription")}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className={labelClassName}>
              {t("fullNameLabel")}
              <input
                type="text"
                name="fullName"
                required
                className={inputClassName}
                placeholder={t("fullNamePlaceholder")}
              />
            </label>

            <label className={labelClassName}>
              {t("companyLabel")}
              <input
                type="text"
                name="company"
                required
                className={inputClassName}
                placeholder={t("companyPlaceholder")}
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className={labelClassName}>
                {t("emailLabel")}
                <input
                  type="email"
                  name="email"
                  required
                  className={inputClassName}
                  placeholder={t("emailPlaceholder")}
                />
              </label>

              <label className={labelClassName}>
                {t("phoneLabel")}
                <input
                  type="tel"
                  name="phone"
                  className={inputClassName}
                  placeholder={t("phonePlaceholder")}
                />
              </label>
            </div>

            <label className={labelClassName}>
              {t("countryLabel")}
              <input
                type="text"
                name="country"
                className={inputClassName}
                placeholder={t("countryPlaceholder")}
              />
            </label>

            <label className={labelClassName}>
              {t("messageLabel")}
              <textarea
                name="message"
                required
                rows={4}
                className={`${inputClassName} resize-none`}
                placeholder={t("messagePlaceholder")}
              />
            </label>

            {errorCode && <p className="text-sm text-red-400">{tErrors(errorCode as never)}</p>}

            <button
              type="submit"
              disabled={isPending}
              className={`${buttonClassName("primary")} w-full disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {isPending ? t("sendingButton") : t("sendButton")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
