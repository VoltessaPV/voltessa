import Image from "next/image";
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/session";
import { routes } from "@/lib/routes";

import { AuthNavActions } from "./AuthNavActions";
import { ContactNavLink } from "./ContactNavLink";
import { MobileNavMenu } from "./MobileNavMenu";
import { SectionNavLink } from "./SectionNavLink";

export default async function Navbar() {
  const user = await getCurrentUser();
  const isAuthenticated = user !== null;

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-3 px-4 sm:px-8">

        {/* Logo */}

        <Link href={routes.home} className="flex min-w-0 shrink items-center gap-3">
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
        </Link>

        {/* Navigation */}

        <nav className="hidden items-center gap-10 text-sm text-slate-300 md:flex">
          <SectionNavLink id="hero" label="Platform" />

          <SectionNavLink id="solutions" label="Solutions" />

          <SectionNavLink id="about" label="About" />

          <ContactNavLink />
        </nav>

        {/* Auth CTAs + mobile menu */}

        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden items-center gap-2 md:flex">
            <AuthNavActions
              isAuthenticated={isAuthenticated}
              className="px-3 py-1.5 text-xs md:px-4 md:py-2 lg:px-6 lg:py-3 lg:text-sm"
            />
          </div>

          <MobileNavMenu isAuthenticated={isAuthenticated} />
        </div>

      </div>
    </header>
  );
}