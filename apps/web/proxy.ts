import createMiddleware from "next-intl/middleware";

import { auth } from "@/auth";
import { DISABLED_LOCALES, routing } from "@/lib/i18n/routing";

/**
 * Full Internationalization milestone. Composes next-intl's locale
 * detection/redirect/rewrite with the existing NextAuth logic below -
 * additive to this file, not a rewrite of it. `/admin` and `/dev` are
 * excluded from the matcher entirely (see `config.matcher`), so
 * `intlMiddleware` never runs for them - no locale prefix, no redirect, no
 * `NextIntlClientProvider` negotiation, ever. Locale resolution itself
 * (cookie -> Accept-Language -> English) happens inside `intlMiddleware`
 * per `routing.ts`'s config; `User.locale` is deliberately NOT read here -
 * see `lib/i18n/routing.ts`'s and `User.locale`'s own doc comments for why
 * (Prisma isn't available in this Edge-runtime middleware, and this exact
 * database has shown real transient connectivity failures during the GDPR
 * milestone - locale resolution stays on the cheap, always-available
 * cookie path). `User.locale` is instead synced to this cookie at sign-in
 * and on every explicit language switch - see `lib/i18n/actions.ts`.
 */
const intlMiddleware = createMiddleware(routing);

const authUrl = process.env.AUTH_URL;
if (!authUrl) {
  throw new Error(
    "AUTH_URL must be set to determine the canonical host for /login redirects."
  );
}
const CANONICAL_HOST = new URL(authUrl).host;

const MARKETING_HOSTS = new Set(["voltessa.ai", "www.voltessa.ai"]);

/** Every auth page/route that must run on the canonical platform host, never the marketing host - session cookies are scoped there. Matched against the pathname with its locale prefix stripped. */
const AUTH_PAGE_PATHS = [
  "/login",
  "/create-account",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
];

const LOCALE_PREFIX_RE = new RegExp(`^/(${routing.locales.join("|")})(?=/|$)`);

/** Strips a leading `/en` or `/bg` segment, if present, so path-matching logic doesn't need to know about locales at all. */
function stripLocalePrefix(pathname: string): string {
  const stripped = pathname.replace(LOCALE_PREFIX_RE, "");
  return stripped === "" ? "/" : stripped;
}

function isAuthPagePath(pathname: string): boolean {
  const stripped = stripLocalePrefix(pathname);
  return AUTH_PAGE_PATHS.some((path) => stripped === path || stripped.startsWith(`${path}/`));
}

/**
 * Bulgarian rollout gate: `DISABLED_LOCALES` is `LOCALES` minus
 * `routing.locales` (see routing.ts's doc comments) - currently just
 * `["bg"]`, but this never hardcodes that so re-enabling a locale (moving
 * it from `LOCALES` into `ENABLED_LOCALES`) automatically empties this
 * regex and turns the redirect below into a no-op, with nothing here to
 * revisit. `null` when nothing is disabled, so the check below is skipped
 * entirely rather than matching against an empty alternation.
 */
const DISABLED_LOCALE_PREFIX_RE =
  DISABLED_LOCALES.length > 0 ? new RegExp(`^/(${DISABLED_LOCALES.join("|")})(?=/|$)`) : null;

export default auth((req) => {
  const host = req.headers.get("host");

  // A disabled locale's URL (e.g. /bg/dashboard while Bulgarian is
  // disabled pending QA - see routing.ts) redirects permanently to its
  // English equivalent rather than 404ing - chosen over the other
  // documented option (letting the locale fall out of the configured list
  // and 404) so an old bookmark or shared link still lands somewhere real.
  // Runs before everything else below: unconditional regardless of host/
  // auth state, and the resulting /en/... URL then goes through the exact
  // same logic on the next request.
  if (DISABLED_LOCALE_PREFIX_RE) {
    const match = req.nextUrl.pathname.match(DISABLED_LOCALE_PREFIX_RE);
    if (match) {
      const rest = req.nextUrl.pathname.slice(match[0].length) || "/";
      const target = new URL(
        `/${routing.defaultLocale}${rest}${req.nextUrl.search}`,
        req.url
      );
      return Response.redirect(target, 308);
    }
  }

  if (
    isAuthPagePath(req.nextUrl.pathname) &&
    host &&
    MARKETING_HOSTS.has(host)
  ) {
    const target = new URL(
      `${req.nextUrl.pathname}${req.nextUrl.search}`,
      `https://${CANONICAL_HOST}`
    );
    return Response.redirect(target, 308);
  }

  const isLoggedIn = !!req.auth;
  const strippedPath = stripLocalePrefix(req.nextUrl.pathname);

  if (strippedPath.startsWith("/dashboard") && !isLoggedIn) {
    const localeMatch = req.nextUrl.pathname.match(LOCALE_PREFIX_RE);
    const prefix = localeMatch ? localeMatch[0] : `/${routing.defaultLocale}`;
    return Response.redirect(new URL(`${prefix}/login`, req.url));
  }

  return intlMiddleware(req);
});

export const config = {
  matcher: [
    // Every route except /admin, /dev, /api, Next internals, and files with an extension (static assets).
    "/((?!api|admin|dev|_next|_vercel|.*\\..*).*)",
  ],
};
