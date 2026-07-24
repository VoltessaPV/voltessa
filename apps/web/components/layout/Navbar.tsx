import Image from "next/image";
import { ContactNavLink } from "./ContactNavLink";
import { SectionNavLink } from "./SectionNavLink";
import { RequestDemoButton } from "../ui/RequestDemoButton";

export default function Navbar() {
  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-8">

        {/* Logo */}

        <div className="flex items-center gap-3">
          <Image
            src="/logo/voltessa-mark.png"
            alt="Voltessa"
            width={60}
            height={60}
            priority
          />

          <span className="text-2xl font-semibold tracking-tight text-white">
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

        {/* CTA */}

        <RequestDemoButton className="px-6 py-3 text-sm" />

      </div>
    </header>
  );
}