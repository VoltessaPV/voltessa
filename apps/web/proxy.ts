import { auth } from "@/auth";

export default auth((req) => {
  const isLoggedIn = !!req.auth;

  if (
    req.nextUrl.pathname.startsWith("/dashboard") &&
    !isLoggedIn
  ) {
    return Response.redirect(new URL("/login", req.url));
  }
});

export const config = {
  matcher: ["/dashboard/:path*"],
};