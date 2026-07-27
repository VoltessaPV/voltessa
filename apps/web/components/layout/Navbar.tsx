import Image from "next/image";
import { ContactNavLink } from "./ContactNavLink";
import { MobileNavMenu } from "./MobileNavMenu";
import { SectionNavLink } from "./SectionNavLink";
import { RequestDemoButton } from "../ui/RequestDemoButton";

export default function Navbar() {
  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-3 px-4 sm:px-8">

        {/* Logo */}

        <div className="flex min-w-0 shrink items-center gap-3">
          <Image
            src="/logo/voltessa-mark.png"
            alt="Voltessa"
            width={60}
            height={60}
            priority
          />

          <span className="truncate text-lg font-semibold tracking-tight text-white sm:text-2xl">
            Voltessa
          </span>
        </div>

        {/* Navigation */}

        <nav className="hidden items-center gap-10 text-sm text-slate-300 md:flex">
          <SectionNavLink id="hero" label="Platform" />

          <SectionNavLink id="solutions" label="Solutions" />

          <SectionNavLink id="about" label="About" />

          <ContactNavLink />
        </nav>

        {/* CTA + mobile menu */}

        <div className="flex shrink-0 items-center gap-2">
          <RequestDemoButton className="px-4 py-2 text-xs sm:px-6 sm:py-3 sm:text-sm" />

          <MobileNavMenu />
        </div>

      </div>
    </header>
  );
}