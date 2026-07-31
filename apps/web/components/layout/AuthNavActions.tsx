import { useTranslations } from "next-intl";
import { Link } from "@/lib/i18n/navigation";

import { routes } from "@/lib/routes";

import { buttonClassName } from "../ui/Button";

type AuthNavActionsProps = {
  isAuthenticated: boolean;
  className?: string;
};

/**
 * The landing page's entry point into the authenticated platform — shown in
 * both Navbar's desktop header row and MobileNavMenu's drawer, replacing
 * the header's previous "Request Demo" button (Request Demo/Talk to Us stay
 * in the Hero and Contact sections, just no longer duplicated in the
 * header). "Log In" opens the dedicated /login page (Google + email/
 * password); "Create Account" opens the dedicated /create-account page —
 * see the Authentication System Refresh milestone. No new session logic
 * here; both pages reuse the existing auth mechanisms.
 */
export function AuthNavActions({ isAuthenticated, className }: AuthNavActionsProps) {
  const tNav = useTranslations("marketing.nav");
  const tHero = useTranslations("marketing.hero");

  if (isAuthenticated) {
    return (
      <Link href={routes.dashboard} className={buttonClassName("primary", className)}>
        {tHero("goToVoltessaLink")}
      </Link>
    );
  }

  return (
    <>
      <Link href={routes.login} className={buttonClassName("secondary", className)}>
        {tNav("logInLink")}
      </Link>

      <Link href={routes.createAccount} className={buttonClassName("primary", className)}>
        {tHero("createAccountLink")}
      </Link>
    </>
  );
}
