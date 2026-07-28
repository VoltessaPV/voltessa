import Link from "next/link";

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
 * header). Reuses the existing Google OAuth flow at /login for both
 * returning and new visitors — PrismaAdapter auto-provisions a User record
 * on first sign-in, so there is no separate registration flow to link to -
 * and the existing /dashboard route once authenticated. No new session or
 * routing logic.
 */
export function AuthNavActions({ isAuthenticated, className }: AuthNavActionsProps) {
  if (isAuthenticated) {
    return (
      <Link href={routes.dashboard} className={buttonClassName("primary", className)}>
        Go to My Voltessa
      </Link>
    );
  }

  return (
    <>
      <Link href={routes.login} className={buttonClassName("secondary", className)}>
        Log In
      </Link>

      <Link href={routes.login} className={buttonClassName("primary", className)}>
        Create Account
      </Link>
    </>
  );
}
