/**
 * Single source of truth for every cookie Voltessa actually sets or causes
 * to be set — the GDPR + Cookie Consent Platform milestone's cookie audit,
 * as code. Drives both the Cookie Policy page's table and the preferences
 * modal's per-category descriptions, so the disclosed list and the actual
 * behavior can never drift apart.
 *
 * This is a complete audit as of this milestone (verified by grepping every
 * `cookies().set`/`.get` call and every analytics/tracking script pattern in
 * `apps/web`), not a generic template list. When a future integration (GA4,
 * Clarity, Meta Pixel) adds a real cookie, add its entry here first — the
 * Cookie Policy page and consent gating read this array, not the other way
 * around.
 */
import type { ConsentCategory } from "./types";

export type CookieRegistryEntry = {
  id: string;
  /** The literal cookie name, or a short description if the provider sets several under one purpose (e.g. Calendly). */
  name: string;
  category: ConsentCategory;
  thirdParty: boolean;
  /** Which company/service sets this cookie. */
  provider: string;
  purpose: { en: string; bg: string };
  duration: { en: string; bg: string };
};

export const COOKIE_REGISTRY: CookieRegistryEntry[] = [
  {
    id: "session-token",
    name: "authjs.session-token / __Secure-authjs.session-token",
    category: "necessary",
    thirdParty: false,
    provider: "Voltessa",
    purpose: {
      en: "Keeps you signed in. Identifies your authenticated session.",
      bg: "Поддържа вашата сесия активна. Идентифицира удостоверената ви сесия.",
    },
    duration: { en: "30 days", bg: "30 дни" },
  },
  {
    id: "csrf-token",
    name: "authjs.csrf-token",
    category: "necessary",
    thirdParty: false,
    provider: "Voltessa",
    purpose: {
      en: "Security cookie that protects the sign-in process from cross-site request forgery.",
      bg: "Защитна бисквитка, която предпазва процеса на вход от cross-site request forgery атаки.",
    },
    duration: { en: "Session", bg: "Сесийна" },
  },
  {
    id: "oauth-handshake",
    name: "authjs.state / authjs.pkce.code_verifier / authjs.callback-url",
    category: "necessary",
    thirdParty: false,
    provider: "Voltessa",
    purpose: {
      en: "Temporary cookies used only during Google sign-in to securely complete the OAuth handshake.",
      bg: "Временни бисквитки, използвани само по време на вход с Google за сигурно завършване на OAuth процеса.",
    },
    duration: { en: "A few minutes (deleted after sign-in completes)", bg: "Няколко минути (изтриват се след завършване на входа)" },
  },
  {
    id: "trader-org",
    name: "voltessa-trader-org",
    category: "necessary",
    thirdParty: false,
    provider: "Voltessa",
    purpose: {
      en: "For Energy Trader accounts with more than one assigned client, remembers which client organization you're currently viewing.",
      bg: "За акаунти на енергийни търговци с повече от един назначен клиент, запомня коя клиентска организация разглеждате в момента.",
    },
    duration: { en: "1 year", bg: "1 година" },
  },
  {
    id: "consent",
    name: "voltessa-consent",
    category: "necessary",
    thirdParty: false,
    provider: "Voltessa",
    purpose: {
      en: "Stores your cookie preferences (this is the cookie that remembers your choices below).",
      bg: "Съхранява вашите предпочитания за бисквитки (това е бисквитката, която запомня вашия избор по-долу).",
    },
    duration: { en: "6 months, or until you change your preferences", bg: "6 месеца или до промяна на предпочитанията ви" },
  },
  {
    id: "locale",
    name: "voltessa-locale",
    category: "necessary",
    thirdParty: false,
    provider: "Voltessa",
    purpose: {
      en: "Remembers your chosen language (English/Bulgarian) for compliance pages and the cookie banner.",
      bg: "Запомня избрания от вас език (английски/български) за страниците за съответствие и банера за бисквитки.",
    },
    duration: { en: "1 year", bg: "1 година" },
  },
  {
    id: "calendly",
    name: "Calendly session/analytics cookies (e.g. __cf_bm, _cfuvid, and Calendly's own)",
    category: "functional",
    thirdParty: true,
    provider: "Calendly",
    purpose: {
      en: "Set only if you click \"Request Demo\" and consent to Functional cookies — powers the embedded scheduling widget.",
      bg: "Задават се само ако натиснете „Заяви демонстрация\" и дадете съгласие за функционални бисквитки — захранват вградения уиджет за насрочване на срещи.",
    },
    duration: { en: "Set by Calendly — see Calendly's own cookie policy", bg: "Задават се от Calendly — вижте политиката за бисквитки на Calendly" },
  },
];

export function getCookiesByCategory(category: ConsentCategory): CookieRegistryEntry[] {
  return COOKIE_REGISTRY.filter((entry) => entry.category === category);
}
