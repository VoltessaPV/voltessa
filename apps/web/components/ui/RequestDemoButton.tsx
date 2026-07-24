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
 * `rootElement` (the portal target react-calendly's popup mounts into)
 * must be a real `HTMLElement`, so it can only be read once mounted in the
 * browser — rendering a plain, visually identical `<button>` until then
 * avoids ever evaluating `document.body` during server rendering (which
 * would throw), and the swap to the real, click-wired button happens
 * essentially immediately after hydration.
 *
 * The event URL is the one exported CALENDLY_EVENT_URL constant
 * (lib/constants.ts) — change it there to repoint every button at once.
 */
const DynamicPopupButton = dynamic(
  () => import("react-calendly").then((mod) => mod.PopupButton),
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

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <button className={buttonClassName(variant, className)}>{text}</button>;
  }

  return (
    <DynamicPopupButton
      url={CALENDLY_EVENT_URL}
      text={text}
      className={buttonClassName(variant, className)}
      rootElement={document.body}
    />
  );
}
