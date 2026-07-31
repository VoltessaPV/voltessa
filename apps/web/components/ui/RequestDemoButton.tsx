"use client";

import { useTranslations } from "next-intl";

import { useCTA } from "@/components/providers/CTAProvider";

import { buttonClassName, type ButtonVariant } from "./Button";

type RequestDemoButtonProps = {
  variant?: ButtonVariant;
  className?: string;
  text?: string;
};

/**
 * Opens the landing page's one shared Calendly modal (see CTAProvider) —
 * never owns its own modal instance or open/close state, so every
 * "Request Demo" button on the page (Navbar, Hero, Contact section) opens
 * the exact same popup instead of each rendering a separate one.
 */
export function RequestDemoButton({
  variant = "primary",
  className,
  text,
}: RequestDemoButtonProps) {
  const { openCalendly } = useCTA();
  const t = useTranslations("marketing.cta");

  return (
    <button type="button" className={buttonClassName(variant, className)} onClick={openCalendly}>
      {text ?? t("requestDemo")}
    </button>
  );
}
