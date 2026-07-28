import { auth } from "@/auth";

const authUrl = process.env.AUTH_URL;
if (!authUrl) {
  throw new Error(
    "AUTH_URL must be set to determine the canonical host for /login redirects."
  );
}
const CANONICAL_HOST = new URL(authUrl).host;

const MARKETING_HOSTS = new Set(["voltessa.ai", "www.voltessa.ai"]);

/** Every auth page/route that must run on the canonical platform host, never the marketing host - session cookies are scoped there. */
const AUTH_PAGE_PATHS = [
  "/login",
  "/create-account",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
];

function isAuthPagePath(pathname: string): boolean {
  return AUTH_PAGE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
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

  if (
    req.nextUrl.pathname.startsWith("/dashboard") &&
    !isLoggedIn
  ) {
    return Response.redirect(new URL("/login", req.url));
  }
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/login",
    "/create-account",
    "/verify-email/:path*",
    "/forgot-password",
    "/reset-password",
  ],
};
