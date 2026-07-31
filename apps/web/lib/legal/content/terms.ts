/**
 * Static prose for the Terms of Service — GDPR + Cookie Consent Platform
 * milestone. Written specifically for Voltessa's actual product (solar/BESS
 * operation with automated export control, the Plant Owner / Energy Trader
 * model, self-service account deletion) — cross-checked against the Privacy
 * Policy (`lib/legal/content/privacy-policy.ts`) so the two never
 * contradict each other, e.g. both describe account deletion the same way.
 */
export type TermsSection = {
  id: string;
  heading: { en: string; bg: string };
  paragraphs: { en: string; bg: string }[];
};

export const TERMS_SECTIONS: TermsSection[] = [
  {
    id: "acceptance",
    heading: { en: "Acceptance of these terms", bg: "Приемане на настоящите условия" },
    paragraphs: [
      {
        en: "These Terms of Service govern your use of Voltessa, operated by Consensu EOOD (trading as \"Voltessa\"), registered in Sofia, Bulgaria (EIK 207238821). By creating an account or otherwise using Voltessa, you agree to these terms.",
        bg: "Настоящите Общи условия уреждат използването на Voltessa, управлявана от „Консенсу\" ЕООД (търгуващо като „Voltessa\"), регистрирано в София, България (ЕИК 207238821). Създавайки акаунт или използвайки Voltessa по друг начин, вие се съгласявате с тези условия.",
      },
    ],
  },
  {
    id: "the-service",
    heading: { en: "The service", bg: "Услугата" },
    paragraphs: [
      {
        en: "Voltessa is an AI-powered platform that operates solar (and, in the future, other renewable) energy assets on behalf of their owners. This includes monitoring plant/device telemetry, and — where you enable it — automatically stopping or resuming electricity export based on market prices and thresholds you configure.",
        bg: "Voltessa е платформа, задвижвана от изкуствен интелект, която управлява соларни (а в бъдеще и други възобновяеми) енергийни активи от името на техните собственици. Това включва наблюдение на телеметрия за централи/устройства и — когато го активирате — автоматично спиране или възобновяване на износа на електроенергия въз основа на пазарни цени и прагове, които вие конфигурирате.",
      },
      {
        en: "This is not only a monitoring dashboard: automation you enable results in real commands sent to your connected plant, which can have real operational and financial consequences. You should treat every threshold and automation setting as a real operational decision, not a cosmetic preference.",
        bg: "Това не е само табло за наблюдение: активираната от вас автоматизация води до реални команди, изпратени към свързаната ви централа, което може да има реални оперативни и финансови последици. Трябва да третирате всеки праг и настройка за автоматизация като реално оперативно решение, а не козметично предпочитание.",
      },
    ],
  },
  {
    id: "accounts",
    heading: { en: "Accounts and organizations", bg: "Акаунти и организации" },
    paragraphs: [
      {
        en: "Voltessa accounts belong to one of two roles: a Plant Owner, who registers an organization and connects and operates plants, or an Energy Trader, who may be granted read-only access to a Plant Owner's data if that Plant Owner (or Voltessa on their behalf) assigns them.",
        bg: "Акаунтите във Voltessa принадлежат към една от две роли: собственик на централа, който регистрира организация и свързва и управлява централи, или енергиен търговец, на когото може да бъде предоставен достъп само за четене до данните на собственик на централа, ако той (или Voltessa от негово име) го назначи.",
      },
      {
        en: "An Energy Trader's access is read-only: it never includes the ability to change plant settings, automation thresholds, or export mode on a Plant Owner's behalf.",
        bg: "Достъпът на енергиен търговец е само за четене: той никога не включва възможност за промяна на настройки на централа, прагове за автоматизация или режим на износ от името на собственик на централа.",
      },
    ],
  },
  {
    id: "your-responsibilities",
    heading: { en: "Your responsibilities", bg: "Вашите отговорности" },
    paragraphs: [
      {
        en: "You are responsible for keeping your sign-in credentials secure, for the accuracy of the information you provide (including billing and energy market settings), and for ensuring you are authorized to connect any plant or FusionSolar account you connect to Voltessa.",
        bg: "Вие носите отговорност за опазването на данните си за вход в тайна, за точността на информацията, която предоставяте (включително настройки за фактуриране и енергиен пазар), и за това да сте оторизирани да свързвате всяка централа или FusionSolar акаунт, който свързвате с Voltessa.",
      },
      {
        en: "You are responsible for the automation thresholds and settings you configure. Voltessa executes the settings you choose; it does not guarantee any particular financial outcome, and you remain responsible for reviewing whether your configuration matches your own operational and commercial intentions.",
        bg: "Вие носите отговорност за прагове и настройки за автоматизация, които конфигурирате. Voltessa изпълнява избраните от вас настройки; тя не гарантира конкретен финансов резултат и вие оставате отговорни да преглеждате дали конфигурацията ви съответства на вашите собствени оперативни и търговски намерения.",
      },
    ],
  },
  {
    id: "fees",
    heading: { en: "Fees", bg: "Такси" },
    paragraphs: [
      {
        en: "Any fees for using Voltessa are as agreed separately between you and Voltessa (for example, in an order form or commercial agreement). These Terms of Service do not themselves set a price.",
        bg: "Всички такси за използване на Voltessa се уговарят отделно между вас и Voltessa (например в поръчка или търговско споразумение). Настоящите Общи условия сами по себе си не определят цена.",
      },
    ],
  },
  {
    id: "account-deletion",
    heading: { en: "Ending your account", bg: "Прекратяване на акаунта" },
    paragraphs: [
      {
        en: "You may delete your own account at any time from Settings → Danger Zone. As described in our Privacy Policy, this permanently deletes your account and profile data; it does not delete your organization or its plant/telemetry/automation data, which belongs to the organization rather than to any one account.",
        bg: "Можете да изтриете собствения си акаунт по всяко време от Настройки → Опасна зона. Както е описано в нашата Политика за поверителност, това окончателно изтрива вашите акаунт и профилни данни; не изтрива вашата организация или нейните данни за централи/телеметрия/автоматизация, които принадлежат на организацията, а не на конкретен акаунт.",
      },
      {
        en: "We may suspend or terminate an account that violates these terms, is used without authorization to connect a plant, or where required by law.",
        bg: "Можем да преустановим или прекратим акаунт, който нарушава тези условия, се използва без оторизация за свързване на централа, или когато това се изисква от закона.",
      },
    ],
  },
  {
    id: "liability",
    heading: { en: "Limitation of liability", bg: "Ограничение на отговорността" },
    paragraphs: [
      {
        en: "Voltessa is provided on an \"as available\" basis. To the fullest extent permitted by Bulgarian law, Voltessa is not liable for indirect, incidental, or consequential losses, including lost revenue from automated export-mode decisions made using the thresholds and settings you configured.",
        bg: "Voltessa се предоставя на принципа „както е налична\". До максималната степен, позволена от българското законодателство, Voltessa не носи отговорност за непреки, случайни или последващи загуби, включително пропуснати приходи от автоматизирани решения за режим на износ, взети въз основа на конфигурираните от вас прагове и настройки.",
      },
    ],
  },
  {
    id: "governing-law",
    heading: { en: "Governing law", bg: "Приложимо право" },
    paragraphs: [
      {
        en: "These terms are governed by the laws of Bulgaria. Any dispute arising from these terms or your use of Voltessa is subject to the jurisdiction of the competent Bulgarian courts, without prejudice to any mandatory consumer-protection or data-protection rights you may have under EU law.",
        bg: "Настоящите условия се уреждат от законите на България. Всеки спор, произтичащ от тези условия или използването на Voltessa, е подсъден на компетентните български съдилища, без да се засягат задължителните права за защита на потребителите или защита на данните, които може да имате съгласно правото на ЕС.",
      },
    ],
  },
  {
    id: "changes",
    heading: { en: "Changes to these terms", bg: "Промени в настоящите условия" },
    paragraphs: [
      {
        en: "We may update these terms from time to time. If we make a material change, we will update the \"Last updated\" date above.",
        bg: "Можем да актуализираме тези условия периодично. Ако направим съществена промяна, ще актуализираме датата „Последна актуализация\" по-горе.",
      },
    ],
  },
  {
    id: "contact",
    heading: { en: "Contact", bg: "Контакт" },
    paragraphs: [
      {
        en: "Questions about these terms can be sent to support@voltessa.ai.",
        bg: "Въпроси относно тези условия можете да изпращате на support@voltessa.ai.",
      },
    ],
  },
];
