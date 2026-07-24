"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { CALENDLY_EVENT_URL } from "@/lib/constants";

import { buttonClassName, type ButtonVariant } from "./Button";

/**
 * The one shared "Request Demo" control every marketing CTA renders —
 * opens the Calendly popup in place (an iframe-based modal; react-calendly
 * never loads any external Calendly script, only the booking iframe itself
 * once actually opened), never a redirect or a new tab. Lazy-loaded via
 * next/dynamic so react-calendly's code is not part of the landing page's
 * initial JS bundle — the same pattern already used for the Dashboard/
 * Market charts (see LiveEnergyChart.dynamic.tsx). `ssr:false` requires
 * this call to live in a Client Component, hence "use client" here.
 *
 * Uses `PopupModal` (not `PopupButton`) so the popup's open/closed state is
 * ours to control directly via its own official `open`/`onModalClose`
 * props — `PopupButton` manages that state privately and exposes no
 * open/close callback, which would leave no lifecycle hook to lock/unlock
 * scroll from. The rendered button itself is ours too, so the click just
 * sets `isOpen`.
 *
 * `rootElement` (the portal target the popup mounts into) must be a real
 * `HTMLElement`, so both it and the dynamic import are only ever touched
 * once mounted in the browser — rendering a plain button (and no modal at
 * all) until then avoids ever evaluating `document` during server
 * rendering, which throws (confirmed directly: removing this guard makes
 * `next build` fail prerendering "/" with "ReferenceError: document is not
 * defined"). `ssr:false` alone does not protect this, since `document.body`
 * is a prop expression evaluated by this component's own render, before
 * React ever gets to whatever the dynamic import decides to render.
 *
 * The event URL is the one exported CALENDLY_EVENT_URL constant
 * (lib/constants.ts) — change it there to repoint every button at once.
 */
const DynamicPopupModal = dynamic(
  () => import("react-calendly").then((mod) => mod.PopupModal),
  { ssr: false },
);

type RequestDemoButtonProps = {
  variant?: ButtonVariant;
  className?: string;
  text?: string;
};

export function RequestDemoButton({
  variant = "primary",
  className,
  text = "Request Demo",
}: RequestDemoButtonProps) {
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Locks background scrolling only while the popup is open, and only for
  // as long as it's open — this effect's own cleanup restores it, whether
  // the popup closes or this component unmounts, so there is never a
  // permanent overflow change. `position: fixed` (not just
  // `overflow: hidden`) is required for this to actually hold on iOS
  // Safari, which otherwise still allows background rubber-band scrolling
  // under a fixed overlay; saving/restoring scrollY keeps the page from
  // visibly jumping when the fixed position is removed.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const scrollY = window.scrollY;
    const { style } = document.body;
    const previous = {
      position: style.position,
      top: style.top,
      width: style.width,
      overflow: style.overflow,
    };

    style.position = "fixed";
    style.top = `-${scrollY}px`;
    style.width = "100%";
    style.overflow = "hidden";

    return () => {
      style.position = previous.position;
      style.top = previous.top;
      style.width = previous.width;
      style.overflow = previous.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [isOpen]);

  return (
    <>
      <button
        type="button"
        className={buttonClassName(variant, className)}
        onClick={() => setIsOpen(true)}
      >
        {text}
      </button>

      {mounted && (
        <DynamicPopupModal
          url={CALENDLY_EVENT_URL}
          open={isOpen}
          onModalClose={() => setIsOpen(false)}
          rootElement={document.body}
        />
      )}
    </>
  );
}
