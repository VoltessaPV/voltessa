"use client";

import { useCTA } from "@/components/providers/CTAProvider";

import { buttonClassName, type ButtonVariant } from "./Button";

type TalkToUsButtonProps = {
  variant?: ButtonVariant;
  className?: string;
  text?: string;
};

/**
 * Opens the landing page's one shared contact form modal (see
 * CTAProvider) — never owns its own modal instance or open/close state,
 * so every "Talk to Us" button on the page (Hero, Contact section) opens
 * the exact same modal instead of each rendering a separate one.
 */
export function TalkToUsButton({
  variant = "secondary",
  className,
  text = "Talk to Us",
}: TalkToUsButtonProps) {
  const { openContactForm } = useCTA();

  return (
    <button type="button" className={buttonClassName(variant, className)} onClick={openContactForm}>
      {text}
    </button>
  );
}
