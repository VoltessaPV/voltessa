"use client";

import { Menu, X } from "lucide-react";
import { useState } from "react";

import { RequestDemoButton } from "../ui/RequestDemoButton";
import { ContactNavLink } from "./ContactNavLink";
import { SectionNavLink } from "./SectionNavLink";

/**
 * Mobile counterpart to Navbar's own nav links, which are `hidden` below
 * `md` with nothing else revealing them — before this, Solutions/About/
 * Contact were completely unreachable from the Navbar below 768px, not
 * just tucked behind a menu. Self-contained (owns its own open/close
 * state), same pattern as the platform shell's `AppSidebar` mobile
 * drawer — no cross-component state needed.
 */
export function MobileNavMenu() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={isOpen ? "Close navigation menu" : "Open navigation menu"}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-white/80 transition hover:text-white"
      >
        {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {isOpen && (
        // Closes on any click inside, including a nav link's own click —
        // event bubbling reaches this handler after the link's own
        // (SectionNavLink/ContactNavLink) preventDefault + smooth-scroll
        // handler already ran, so no change to those shared components.
        <div
          onClick={() => setIsOpen(false)}
          className="absolute inset-x-0 top-full border-t border-white/10 bg-[#050816] px-6 py-6 shadow-lg"
        >
          <nav className="flex flex-col gap-5 text-sm text-slate-300">
            <SectionNavLink id="hero" label="Platform" />
            <SectionNavLink id="solutions" label="Solutions" />
            <SectionNavLink id="about" label="About" />
            <ContactNavLink />
          </nav>

          <RequestDemoButton className="mt-6 w-full py-3 text-center text-sm" />
        </div>
      )}
    </div>
  );
}
