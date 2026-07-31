"use server";

import { cookies } from "next/headers";

import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

import { LOCALE_COOKIE_NAME, routing, type AppLocale } from "./routing";

/**
 * The one place an explicit language switch is written. Mirrors
 * `syncUserLocale`'s two-write shape (cookie always; `User.locale` too,
 * when signed in) so the two paths that set locale — sign-in and an
 * explicit switch — behave identically. The calling client component
 * (`components/i18n/LanguageSwitcher.tsx`) is responsible for the actual
 * navigation afterward (`router.replace(pathname, { locale })`, staying on
 * the current page) — this action only persists the choice.
 *
 * Guarded against a disabled locale (`routing.locales`, not the full
 * `LOCALES` — see routing.ts's rollout-gate doc comment): the switcher
 * itself never renders a control for one, but this is the actual
 * enforcement point — "prevent users from selecting Bulgarian" holds even
 * against a hand-crafted call, not just by hiding the UI.
 */
export async function setLocale(locale: AppLocale): Promise<void> {
  if (!(routing.locales as readonly string[]).includes(locale)) {
    return;
  }

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE_NAME, locale, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });

  const currentUser = await getCurrentUser().catch(() => null);

  if (currentUser) {
    await prisma.user.update({
      where: { id: currentUser.id },
      data: { locale },
    });
  }
}
