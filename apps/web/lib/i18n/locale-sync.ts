import { cookies } from "next/headers";

import { prisma } from "@/lib/prisma";

import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, LOCALES, routing, type AppLocale } from "./routing";

/**
 * Deliberately checked against the full `LOCALES` set, NOT `routing.locales`
 * (the currently-*enabled* subset — see routing.ts's rollout-gate doc
 * comment). A user whose stored `User.locale` is a real, known locale that
 * is simply disabled right now (Bulgarian, pending QA) must keep that
 * value untouched — this function's job is data-integrity ("is this a
 * genuine, recognized preference"), never "is this reachable today", so it
 * must not fall into this file's own overwrite-with-default branch below
 * just because a locale is temporarily disabled.
 */
function isKnownLocale(value: string | null | undefined): value is AppLocale {
  return Boolean(value) && (LOCALES as readonly string[]).includes(value as AppLocale);
}

/**
 * Full Internationalization milestone. Called synchronously — never
 * deferred via `after()` — from both sign-in paths (`lib/auth/config.ts`'s
 * `events.signIn` for Google, `app/login/actions.ts`'s `signInWithPassword`
 * for password login — the two never share a code path until a session
 * already exists, per that file's own doc comment, so both call this
 * independently) because it must mutate the locale cookie on the response
 * still being built for THIS request; `after()`-deferred code runs after
 * the response is already sent and can't affect it.
 *
 * Resolution order (`User.locale` -> cookie -> `Accept-Language` -> English,
 * per the approved architecture): if `User.locale` is already set, it wins
 * — overwrite the cookie to match so a stored preference actually follows
 * the person across devices/browsers, not just the one that set it. If
 * `User.locale` is `null` (first sign-in), adopt whatever the cookie/
 * Accept-Language chain already resolved to for this request (read by
 * `proxy.ts`'s `intlMiddleware` before this ever runs) and persist it as
 * the user's new stored preference.
 */
export async function syncUserLocale(userId: string): Promise<void> {
  const [user, cookieStore] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { locale: true } }),
    cookies(),
  ]);

  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;

  if (isKnownLocale(user?.locale)) {
    if (cookieLocale !== user.locale) {
      cookieStore.set(LOCALE_COOKIE_NAME, user.locale, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    return;
  }

  // No stored preference yet: only ever adopt the cookie's value into a
  // brand-new User.locale when it's a currently *enabled* locale - a
  // leftover cookie from before Bulgarian was disabled must not newly
  // persist "bg" into the database for a user who never actually had that
  // preference stored. `routing.locales` (enabled), not `LOCALES` (known),
  // is the right check here for exactly that reason.
  const adopted: AppLocale =
    isKnownLocale(cookieLocale) && (routing.locales as readonly string[]).includes(cookieLocale)
      ? cookieLocale
      : DEFAULT_LOCALE;
  await prisma.user.update({ where: { id: userId }, data: { locale: adopted } });
}
