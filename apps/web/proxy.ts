import createMiddleware from "next-intl/middleware";

import { auth } from "@/auth";
import { routing } from "@/lib/i18n/routing";

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

export default auth((req) => {
  const host = req.headers.get("host");

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
