import { auth } from "@/auth";

const authUrl = process.env.AUTH_URL;
if (!authUrl) {
  throw new Error(
    "AUTH_URL must be set to determine the canonical host for /login redirects."
  );
}
const CANONICAL_HOST = new URL(authUrl).host;

const MARKETING_HOSTS = new Set(["voltessa.ai", "www.voltessa.ai"]);

export default auth((req) => {
  const host = req.headers.get("host");

  if (
    req.nextUrl.pathname === "/login" &&
    host &&
    MARKETING_HOSTS.has(host)
  ) {
    const target = new URL(
      `/login${req.nextUrl.search}`,
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
  matcher: ["/dashboard/:path*", "/login"],
};