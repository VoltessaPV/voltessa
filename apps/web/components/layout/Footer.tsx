import { CookieSettingsLink } from "@/components/consent/CookieSettingsLink";
import { SUPPORT_EMAIL } from "@/lib/constants";
import { routes } from "@/lib/routes";

export default function Footer() {
  return (
    <footer className="border-t border-slate-900 bg-[#050816]">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-4 py-10 text-sm text-slate-500 sm:px-8 md:flex-row">

        <div>
          © {new Date().getFullYear()} Voltessa. All rights reserved.
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">

          <a
            href={routes.privacy}
            className="transition hover:text-white"
          >
            Privacy
          </a>

          <a
            href={routes.cookiePolicy}
            className="transition hover:text-white"
          >
            Cookie Policy
          </a>

          <a
            href={routes.terms}
            className="transition hover:text-white"
          >
            Terms
          </a>

          <a
            href={routes.company}
            className="transition hover:text-white"
          >
            Company Information
          </a>

          <CookieSettingsLink className="transition hover:text-white">
            Cookie Settings
          </CookieSettingsLink>

          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="transition hover:text-white"
          >
            Contact
          </a>

        </div>

      </div>
    </footer>
  );
}