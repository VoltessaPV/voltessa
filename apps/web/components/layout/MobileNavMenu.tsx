"use client";

import { Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { AuthNavActions } from "./AuthNavActions";
import { ContactNavLink } from "./ContactNavLink";
import { SectionNavLink } from "./SectionNavLink";

type MobileNavMenuProps = {
  isAuthenticated: boolean;
};

/**
 * Mobile counterpart to Navbar's own nav links, which are `hidden` below
 * `md` with nothing else revealing them — before this, Solutions/About/
 * Contact were completely unreachable from the Navbar below 768px, not
 * just tucked behind a menu. Self-contained (owns its own open/close
 * state), same pattern as the platform shell's `AppSidebar` mobile
 * drawer — no cross-component state needed. Also the only place the
 * header's auth CTAs (AuthNavActions) reach mobile visitors, since
 * Navbar's own copy is `hidden md:flex`.
 */
export function MobileNavMenu({ isAuthenticated }: MobileNavMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const t = useTranslations("marketing.nav");
  // Reuses navigation.sidebar's open/close menu labels rather than a second pair of near-identical strings.
  const tMenu = useTranslations("navigation.sidebar");

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={isOpen ? tMenu("closeMenuLabel") : tMenu("openMenuLabel")}
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
            <SectionNavLink id="hero" label={t("platformLink")} />
            <SectionNavLink id="solutions" label={t("solutionsLink")} />
            <SectionNavLink id="about" label={t("aboutLink")} />
            <ContactNavLink />
          </nav>

          <div className="mt-6 flex flex-col gap-3">
            <AuthNavActions isAuthenticated={isAuthenticated} className="w-full py-3 text-center text-sm" />
          </div>
        </div>
      )}
    </div>
  );
}
