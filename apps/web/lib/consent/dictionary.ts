import type { Locale } from "@/lib/i18n/locale";

export type ConsentDictionary = {
  banner: {
    heading: string;
    body: string;
    acceptAll: string;
    rejectAll: string;
    customize: string;
  };
  modal: {
    title: string;
    description: string;
    save: string;
    acceptAll: string;
    rejectAll: string;
    close: string;
    categories: {
      necessary: { title: string; description: string; alwaysOn: string };
      functional: { title: string; description: string };
      analytics: { title: string; description: string };
      marketing: { title: string; description: string };
    };
  };
};

const en: ConsentDictionary = {
  banner: {
    heading: "We value your privacy",
    body: "We use cookies to run Voltessa securely and, with your consent, to understand how the platform is used. You can change your choice at any time from “Cookie Settings” in the footer.",
    acceptAll: "Accept All",
    rejectAll: "Reject All",
    customize: "Customize",
  },
  modal: {
    title: "Cookie Preferences",
    description: "Strictly necessary cookies are always on because Voltessa can't function without them. You choose everything else.",
    save: "Save Preferences",
    acceptAll: "Accept All",
    rejectAll: "Reject All",
    close: "Close",
    categories: {
      necessary: {
        title: "Strictly Necessary",
        description: "Required for sign-in, security, and core functionality.",
        alwaysOn: "Always On",
      },
      functional: {
        title: "Functional",
        description: "Enables optional features, such as our Calendly scheduling widget.",
      },
      analytics: {
        title: "Analytics & Performance",
        description: "Would help us understand how Voltessa is used, so we can improve it. Not currently in use — no analytics cookies are set today.",
      },
      marketing: {
        title: "Marketing",
        description: "Would support advertising measurement. Not currently in use — no marketing cookies are set today.",
      },
    },
  },
};

const bg: ConsentDictionary = {
  banner: {
    heading: "Ценим Вашата поверителност",
    body: "Използваме бисквитки, за да осигурим сигурната работа на Voltessa и, с Ваше съгласие, за да разберем как се използва платформата. Можете да промените избора си по всяко време от „Настройки за бисквитки“ във футъра.",
    acceptAll: "Приеми всички",
    rejectAll: "Отхвърли всички",
    customize: "Персонализирай",
  },
  modal: {
    title: "Предпочитания за бисквитки",
    description: "Строго необходимите бисквитки винаги са активни, защото Voltessa не може да функционира без тях. Всичко останало избирате Вие.",
    save: "Запази предпочитанията",
    acceptAll: "Приеми всички",
    rejectAll: "Отхвърли всички",
    close: "Затвори",
    categories: {
      necessary: {
        title: "Строго необходими",
        description: "Необходими за вход, сигурност и основна функционалност.",
        alwaysOn: "Винаги активни",
      },
      functional: {
        title: "Функционални",
        description: "Активират незадължителни функции, като нашия уиджет за насрочване на срещи Calendly.",
      },
      analytics: {
        title: "Анализи и производителност",
        description: "Биха ни помогнали да разберем как се използва Voltessa, за да я подобрим. Понастоящем не се използват — днес не се задават бисквитки за анализи.",
      },
      marketing: {
        title: "Маркетинг",
        description: "Биха подпомогнали измерването на реклами. Понастоящем не се използват — днес не се задават маркетингови бисквитки.",
      },
    },
  },
};

export const CONSENT_DICTIONARIES: Record<Locale, ConsentDictionary> = { en, bg };

export function getConsentDictionary(locale: Locale): ConsentDictionary {
  return CONSENT_DICTIONARIES[locale];
}
