"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { useConsent } from "@/components/consent/ConsentProvider";
import { CookieSettingsLink } from "@/components/consent/CookieSettingsLink";
import { CALENDLY_EVENT_URL } from "@/lib/constants";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";

/**
 * The single, shared Calendly popup instance for the whole landing page —
 * rendered once by CTAProvider and controlled entirely via `open`/`onClose`
 * so every "Request Demo" button opens the exact same modal instead of
 * each owning its own. Behavior is unchanged from the original
 * implementation: `PopupModal` (not `PopupButton`, since `PopupButton`
 * exposes no open/close callback — there would be no lifecycle to lock
 * scroll from), lazy-loaded via next/dynamic so its code stays out of the
 * landing page's initial JS bundle, and the mount-gate for
 * `rootElement={document.body}`.
 *
 * `ssr:false` alone does not make the mount-gate redundant: `document.body`
 * is a prop expression evaluated by this component's own render, which
 * still runs during SSR regardless of `ssr:false` (confirmed directly —
 * removing this gate makes `next build` fail prerendering "/" with
 * "ReferenceError: document is not defined").
 */
const DynamicPopupModal = dynamic(
  () => import("react-calendly").then((mod) => mod.PopupModal),
  { ssr: false },
);

type CalendlyModalProps = {
  open: boolean;
  onClose: () => void;
};

export function CalendlyModal({ open, onClose }: CalendlyModalProps) {
  const [mounted, setMounted] = useState(false);
  const { consent } = useConsent();

  useEffect(() => {
    setMounted(true);
  }, []);

  useBodyScrollLock(open);

  if (!mounted) {
    return null;
  }

  /**
   * Cookie audit finding (GDPR + Cookie Consent Platform milestone):
   * Calendly's widget sets its own third-party cookies from calendly.com the
   * moment its iframe loads. Loading it only on this explicit click (rather
   * than on page load) was already a mitigating factor, but isn't a
   * substitute for consent — so the real widget still only mounts once
   * Functional consent is actually granted. Without it, this shows a
   * placeholder instead of silently loading calendly.com.
   */
  if (!consent?.functional) {
    if (!open) {
      return null;
    }

    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4">
        <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#050816] p-6 text-center shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)]">
          <p className="text-sm font-medium text-white">Functional cookies required</p>

          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            Scheduling a call uses Calendly, a third-party widget that sets its own cookies.
            Enable Functional cookies in Cookie Settings to continue.
          </p>

          <div className="mt-5 flex justify-center gap-2.5">
            <CookieSettingsLink className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-blue-500">
              Open Cookie Settings
            </CookieSettingsLink>

            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-medium text-white transition hover:bg-white/10"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <DynamicPopupModal
      url={CALENDLY_EVENT_URL}
      open={open}
      onModalClose={onClose}
      rootElement={document.body}
    />
  );
}
