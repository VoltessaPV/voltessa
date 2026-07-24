"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { CalendlyModal } from "@/components/ui/CalendlyModal";
import { ContactModal } from "@/components/ui/ContactModal";

type CTAContextValue = {
  openCalendly: () => void;
  openContactForm: () => void;
  scrollToContact: () => void;
};

const CTAContext = createContext<CTAContextValue | null>(null);

/**
 * The single source of truth for every landing-page CTA: opening the
 * Calendly popup, opening the contact form modal, and scrolling to the
 * Contact section. Wraps the whole landing page once (see Hero.tsx) and
 * renders exactly one instance each of CalendlyModal/ContactModal — every
 * button (Navbar, Hero, Contact section) calls the same functions via
 * useCTA() instead of owning its own modal/state, so there is only ever
 * one Calendly popup and one contact form on the page, however many
 * buttons trigger them.
 */
export function CTAProvider({ children }: { children: ReactNode }) {
  const [isCalendlyOpen, setIsCalendlyOpen] = useState(false);
  const [isContactOpen, setIsContactOpen] = useState(false);

  const scrollToContact = useCallback(() => {
    document.getElementById("contact")?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const value = useMemo<CTAContextValue>(
    () => ({
      openCalendly: () => setIsCalendlyOpen(true),
      openContactForm: () => setIsContactOpen(true),
      scrollToContact,
    }),
    [scrollToContact],
  );

  return (
    <CTAContext.Provider value={value}>
      {children}
      <CalendlyModal open={isCalendlyOpen} onClose={() => setIsCalendlyOpen(false)} />
      <ContactModal open={isContactOpen} onClose={() => setIsContactOpen(false)} />
    </CTAContext.Provider>
  );
}

export function useCTA(): CTAContextValue {
  const ctx = useContext(CTAContext);

  if (!ctx) {
    throw new Error("useCTA must be used within a CTAProvider");
  }

  return ctx;
}
