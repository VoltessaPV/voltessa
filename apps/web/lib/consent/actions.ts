"use server";

import { cookies, headers } from "next/headers";

import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

import {
  CONSENT_COOKIE_MAX_AGE_SECONDS,
  CONSENT_COOKIE_NAME,
  CONSENT_VERSION,
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  LOCALE_COOKIE_NAME,
} from "./constants";
import type { ConsentAction, ConsentPayload } from "./types";

type SaveConsentInput = {
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
  action: ConsentAction;
};

/**
 * The only place a consent decision is written — banner (Accept All/Reject
 * All), preferences modal (Customize/Save), and the footer "Cookie Settings"
 * entry all call this same action, mirroring the existing
 * `selectTraderOrganization` pattern (`app/(platform)/actions.ts`) of
 * writing a first-party cookie through a Server Action rather than raw
 * client-side `document.cookie`.
 *
 * Writes two things, in this order: the `voltessa-consent` cookie (what the
 * rest of the app reads to decide what to render — see
 * `lib/consent/session.ts`), and a `ConsentLog` row (the append-only proof-
 * of-consent record — see that model's own schema comment for why it's
 * never updated or superseded). `getCurrentUser()` is best-effort: most
 * consent decisions happen before signup, where it's `null` and the log row
 * is written with `userId: null`.
 */
export async function saveConsent(input: SaveConsentInput): Promise<void> {
  const payload: ConsentPayload = {
    necessary: true,
    functional: input.functional,
    analytics: input.analytics,
    marketing: input.marketing,
    version: CONSENT_VERSION,
    updatedAt: new Date().toISOString(),
  };

  const cookieStore = await cookies();
  cookieStore.set(CONSENT_COOKIE_NAME, JSON.stringify(payload), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: CONSENT_COOKIE_MAX_AGE_SECONDS,
  });

  const [currentUser, headerList] = await Promise.all([
    getCurrentUser().catch(() => null),
    headers(),
  ]);

  await prisma.consentLog.create({
    data: {
      userId: currentUser?.id ?? null,
      version: CONSENT_VERSION,
      necessary: true,
      functional: input.functional,
      analytics: input.analytics,
      marketing: input.marketing,
      action: input.action,
      userAgent: headerList.get("user-agent"),
    },
  });
}

/** Backs the small EN/BG toggle on the banner, preferences modal, and legal pages. */
export async function setLocale(locale: "en" | "bg"): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE_NAME, locale, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
  });
}
