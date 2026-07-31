/**
 * Every third party that processes data on Voltessa's behalf, as actually
 * wired up in this codebase today — not a generic/template list. Cross-
 * checked against `CLAUDE.md`'s Configuration section and
 * `docs/infrastructure/scaleway-production.md`. Read by the Privacy Policy
 * (and only the Privacy Policy) so this list and the rendered policy can
 * never drift apart.
 *
 * The managed PostgreSQL provider is deliberately generic: it is not
 * confirmed anywhere in the repository or deployment configuration (only
 * reached via `DATABASE_URL`), and must not be guessed at. Once the actual
 * provider is confirmed, update the `name` field below only — no other file,
 * and no page content, needs to change.
 */
export type SubProcessor = {
  id: string;
  name: string;
  purpose: { en: string; bg: string };
};

export const SUB_PROCESSORS: SubProcessor[] = [
  {
    id: "database",
    name: "Managed PostgreSQL database infrastructure operated by our hosting providers",
    purpose: {
      en: "Primary application database — stores account, organization, plant, telemetry, automation, and consent records.",
      bg: "Основна база данни на приложението — съхранява данни за акаунти, организации, централи, телеметрия, автоматизация и съгласие.",
    },
  },
  {
    id: "vercel",
    name: "Vercel Inc.",
    purpose: {
      en: "Hosts and serves the Voltessa web application (Next.js).",
      bg: "Хоства и обслужва уеб приложението на Voltessa (Next.js).",
    },
  },
  {
    id: "google",
    name: "Google LLC",
    purpose: {
      en: "Google Sign-In (OAuth) — used only if you choose to sign in with Google.",
      bg: "Google Sign-In (OAuth) — използва се само ако изберете вход с Google.",
    },
  },
  {
    id: "resend",
    name: "Resend",
    purpose: {
      en: "Delivers transactional emails (email verification, password reset).",
      bg: "Доставя транзакционни имейли (потвърждение на имейл, възстановяване на парола).",
    },
  },
  {
    id: "ntfy",
    name: "ntfy.sh",
    purpose: {
      en: "Delivers push notifications about automation events (export-mode changes, automation failures). Notification content covers plant/automation status only, never personal data.",
      bg: "Доставя push известия за събития от автоматизацията (промени в режима на износ, грешки в автоматизацията). Съдържанието на известията се отнася само до статуса на централата/автоматизацията, никога до лични данни.",
    },
  },
  {
    id: "scaleway",
    name: "Scaleway",
    purpose: {
      en: "Hosts the infrastructure that connects to your Huawei FusionSolar account on your behalf (the FusionSolar gateway proxy) and runs the scheduled telemetry, market-price, and automation jobs.",
      bg: "Хоства инфраструктурата, която се свързва с вашия акаунт в Huawei FusionSolar от ваше име (FusionSolar gateway proxy) и изпълнява планираните задачи за телеметрия, пазарни цени и автоматизация.",
    },
  },
  {
    id: "huawei-fusionsolar",
    name: "Huawei FusionSolar",
    purpose: {
      en: "Where you connect a plant, Voltessa retrieves plant and device telemetry from your own FusionSolar account, which you authorize via OAuth.",
      bg: "Когато свържете централа, Voltessa извлича телеметрия за централата и устройствата от вашия собствен акаунт във FusionSolar, който вие оторизирате чрез OAuth.",
    },
  },
  {
    id: "calendly",
    name: "Calendly",
    purpose: {
      en: "Scheduling widget on our marketing site, loaded only if you click \"Request Demo\" and consent to Functional cookies.",
      bg: "Уиджет за насрочване на срещи на нашия маркетингов сайт, зареждан само ако натиснете „Заяви демонстрация\" и дадете съгласие за функционални бисквитки.",
    },
  },
];
