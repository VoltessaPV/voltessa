"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

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

  useEffect(() => {
    setMounted(true);
  }, []);

  useBodyScrollLock(open);

  if (!mounted) {
    return null;
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
