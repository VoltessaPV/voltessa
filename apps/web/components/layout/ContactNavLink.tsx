"use client";

import { useTranslations } from "next-intl";

import { useCTA } from "@/components/providers/CTAProvider";

/**
 * The Navbar's "Contact" link — smooth-scrolls to the Contact section via
 * the shared CTAProvider instead of a plain anchor jump. Kept as its own
 * tiny client component so Navbar itself stays a Server Component; a real
 * `href="#contact"` is preserved so the link still works (as a plain jump)
 * before hydration or with JS disabled.
 */
export function ContactNavLink() {
  const { scrollToContact } = useCTA();
  const t = useTranslations("marketing.nav");

  return (
    <a
      href="#contact"
      onClick={(event) => {
        event.preventDefault();
        scrollToContact();
      }}
      className="transition hover:text-white"
    >
      {t("contactLink")}
    </a>
  );
}
