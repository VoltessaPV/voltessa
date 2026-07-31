import { useTranslations } from "next-intl";

import { CookieSettingsLink } from "@/components/consent/CookieSettingsLink";
import { Link } from "@/lib/i18n/navigation";
import { SUPPORT_EMAIL } from "@/lib/constants";
import { routes } from "@/lib/routes";

export default function Footer() {
  const t = useTranslations("shared.footer");

  return (
    <footer className="border-t border-slate-900 bg-[#050816]">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-4 py-10 text-sm text-slate-500 sm:px-8 md:flex-row">

        <div>
          {t("copyright", { year: new Date().getFullYear() })}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">

          <Link
            href={routes.privacy}
            className="transition hover:text-white"
          >
            {t("privacyLink")}
          </Link>

          <Link
            href={routes.cookiePolicy}
            className="transition hover:text-white"
          >
            {t("cookiePolicyLink")}
          </Link>

          <Link
            href={routes.terms}
            className="transition hover:text-white"
          >
            {t("termsLink")}
          </Link>

          <Link
            href={routes.company}
            className="transition hover:text-white"
          >
            {t("companyInformationLink")}
          </Link>

          <CookieSettingsLink className="transition hover:text-white">
            {t("cookieSettingsLink")}
          </CookieSettingsLink>

          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="transition hover:text-white"
          >
            {t("contactLink")}
          </a>

        </div>

      </div>
    </footer>
  );
}
