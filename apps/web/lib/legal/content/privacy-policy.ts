/**
 * Static prose for the Privacy Policy — GDPR + Cookie Consent Platform
 * milestone. Written specifically for how Voltessa actually works (verified
 * against `prisma/schema.prisma`, `CLAUDE.md`, and the codebase directly),
 * not generic template legal text. Dynamic parts (the retention schedule,
 * the sub-processor list, the cookie summary) are rendered in
 * `app/privacy/page.tsx` directly from `lib/legal/data-retention.ts`,
 * `lib/legal/sub-processors.ts`, and `lib/consent/cookie-registry.ts` — this
 * file holds only the parts that are genuinely just prose.
 */
export type PrivacySection = {
  id: string;
  heading: { en: string; bg: string };
  paragraphs: { en: string; bg: string }[];
};

export const PRIVACY_POLICY_SECTIONS: PrivacySection[] = [
  {
    id: "who-we-are",
    heading: { en: "Who we are", bg: "Кои сме ние" },
    paragraphs: [
      {
        en: "Voltessa is operated by Consensu EOOD (trading as \"Voltessa\"), registered in Sofia, Bulgaria (EIK 207238821, registered address: Pozitano Str. 14, 1301 Sofia, Bulgaria). We are the data controller for the personal data described in this policy.",
        bg: "Voltessa се управлява от „Консенсу\" ЕООД (търгуващо като „Voltessa\"), регистрирано в София, България (ЕИК 207238821, седалище: ул. Позитано 14, 1301 София, България). Ние сме администратор на личните данни, описани в тази политика.",
      },
      {
        en: "Voltessa is an AI-powered platform that operates solar (and, in the future, other renewable) energy assets on behalf of their owners — including automatic export stop/resume decisions driven by electricity market prices — rather than only providing a monitoring dashboard.",
        bg: "Voltessa е платформа, задвижвана от изкуствен интелект, която управлява соларни (а в бъдеще и други възобновяеми) енергийни активи от името на техните собственици — включително автоматични решения за спиране/възобновяване на износа на електроенергия въз основа на пазарни цени — а не само предоставя табло за наблюдение.",
      },
    ],
  },
  {
    id: "data-we-collect",
    heading: { en: "Data we collect", bg: "Данни, които събираме" },
    paragraphs: [
      {
        en: "Account and profile data: your name, email address, profile image, phone number, and (if you sign in with a password) a securely hashed password. If you sign in with Google, we receive your name, email, and profile picture from Google.",
        bg: "Данни за акаунт и профил: вашето име, имейл адрес, профилна снимка, телефонен номер и (ако влизате с парола) сигурно хеширана парола. Ако влизате с Google, получаваме вашето име, имейл и профилна снимка от Google.",
      },
      {
        en: "Organization data: your organization's name, and — if you are a Plant Owner — billing/invoicing details (company name, tax identification number, address, invoice email) and energy market settings (country, electricity supplier, distribution network operator).",
        bg: "Данни за организацията: името на вашата организация и — ако сте собственик на централа — данни за фактуриране (име на фирма, данъчен идентификационен номер, адрес, имейл за фактури) и настройки на енергийния пазар (държава, доставчик на електроенергия, оператор на разпределителна мрежа).",
      },
      {
        en: "Plant and device data: if you connect a solar plant via Huawei FusionSolar, we retrieve and store plant/device telemetry (production, consumption, export/import readings) and daily production/consumption figures, so we can display them to you and, where you enable it, make automated export-mode decisions.",
        bg: "Данни за централи и устройства: ако свържете соларна централа чрез Huawei FusionSolar, ние извличаме и съхраняваме телеметрия за централата/устройствата (производство, потребление, показания за износ/внос) и дневни стойности за производство/потребление, за да можем да ви ги показваме и, когато го активирате, да вземаме автоматизирани решения за режима на износ.",
      },
      {
        en: "Energy Trader data: if you register as an Energy Trader, we collect your trader profile (company name, distribution operator) and which Plant Owner organizations you are assigned to view, on a read-only basis.",
        bg: "Данни за енергиен търговец: ако се регистрирате като енергиен търговец, събираме данни за търговския ви профил (име на фирма, оператор на разпределителна мрежа) и към кои организации на собственици на централи имате назначен достъп само за четене.",
      },
      {
        en: "Administrative and security data: if you interact with a Platform Administrator (our own staff), actions taken on your account are recorded in an internal audit log, and any support access to your account (\"impersonation\") is logged with a timestamp and the admin who performed it.",
        bg: "Административни данни и данни за сигурност: ако взаимодействате с администратор на платформата (наш служител), действията, извършени във вашия акаунт, се записват във вътрешен одитен дневник, а всеки достъп за поддръжка до вашия акаунт се записва с времева марка и администратора, който го е извършил.",
      },
      {
        en: "Cookie and consent data: which cookie categories you have consented to, and a history of that choice — see \"Cookies\" below and our Cookie Policy.",
        bg: "Данни за бисквитки и съгласие: за кои категории бисквитки сте дали съгласие и история на този избор — вижте „Бисквитки\" по-долу и нашата Политика за бисквитки.",
      },
    ],
  },
  {
    id: "why-we-process",
    heading: { en: "Why we process your data", bg: "Защо обработваме вашите данни" },
    paragraphs: [
      {
        en: "To provide the service to you (performance of a contract): creating your account, operating your connected plants, running automation you've enabled, and Energy Trader read-only access you've been assigned.",
        bg: "За предоставяне на услугата (изпълнение на договор): създаване на вашия акаунт, управление на свързаните ви централи, изпълнение на активираната от вас автоматизация и достъп само за четене за назначени енергийни търговци.",
      },
      {
        en: "To comply with a legal obligation: for example, retaining certain financial/accounting records for the period required by Bulgarian law, or demonstrating that a cookie consent decision was validly obtained.",
        bg: "За спазване на законово задължение: например съхранение на определени финансови/счетоводни документи за срока, изискван от българското законодателство, или доказване, че решение за съгласие за бисквитки е получено валидно.",
      },
      {
        en: "For our legitimate interests: keeping the platform secure, maintaining an audit trail of administrative and automated actions so they remain explainable, and improving the service — always balanced against your rights and expectations.",
        bg: "За наши легитимни интереси: поддържане на сигурността на платформата, поддържане на одитна следа за административни и автоматизирани действия, за да останат обясними, и подобряване на услугата — винаги балансирано спрямо вашите права и очаквания.",
      },
      {
        en: "With your consent: non-essential cookies (Functional, Analytics, Marketing) — see \"Cookies\" below. You can withdraw this consent at any time with no effect on the service itself.",
        bg: "С вашето съгласие: незадължителни бисквитки (функционални, аналитични, маркетингови) — вижте „Бисквитки\" по-долу. Можете да оттеглите това съгласие по всяко време без ефект върху самата услуга.",
      },
    ],
  },
  {
    id: "cookies",
    heading: { en: "Cookies", bg: "Бисквитки" },
    paragraphs: [
      {
        en: "Voltessa uses strictly necessary cookies to keep the platform working (signing in, remembering security state), and — only with your consent — a small number of functional cookies for an embedded scheduling widget. We do not currently use analytics or marketing cookies. The full list of cookies, what each one does, and how to change your choice at any time is in our Cookie Policy.",
        bg: "Voltessa използва строго необходими бисквитки, за да функционира платформата (вход, запомняне на състоянието на сигурност), и — само с ваше съгласие — малък брой функционални бисквитки за вграден уиджет за насрочване на срещи. Понастоящем не използваме аналитични или маркетингови бисквитки. Пълният списък с бисквитки, какво прави всяка от тях и как да промените избора си по всяко време, е в нашата Политика за бисквитки.",
      },
    ],
  },
  {
    id: "your-rights",
    heading: { en: "Your rights", bg: "Вашите права" },
    paragraphs: [
      {
        en: "Under the GDPR, you have the right to access the personal data we hold about you, request its correction, request its erasure, request that we restrict or object to certain processing, and request a portable copy of it. You can exercise any of these rights by contacting us at privacy@voltessa.ai — as of this version of the policy, these requests are handled manually rather than through a self-service tool, and we aim to respond within one month.",
        bg: "Съгласно ОРЗД имате право на достъп до личните данни, които съхраняваме за вас, да поискате тяхното коригиране, изтриване, ограничаване или възражение срещу определена обработка, както и преносим екземпляр от тях. Можете да упражните всяко от тези права, като се свържете с нас на privacy@voltessa.ai — към момента на тази версия на политиката тези заявки се обработват ръчно, а не чрез инструмент за самообслужване, и се стремим да отговорим в срок от един месец.",
      },
      {
        en: "You can update your own profile information (name, phone) at any time from Settings, and delete your own account at any time from Settings → Danger Zone — see \"Deleting your account\" below.",
        bg: "Можете да актуализирате собствената си профилна информация (име, телефон) по всяко време от Настройки и да изтриете собствения си акаунт по всяко време от Настройки → Опасна зона — вижте „Изтриване на акаунта\" по-долу.",
      },
      {
        en: "You have the right to lodge a complaint with a supervisory authority. As we are registered in Bulgaria, the competent authority is the Commission for Personal Data Protection (CPDP), www.cpdp.bg.",
        bg: "Имате право да подадете жалба до надзорен орган. Тъй като сме регистрирани в България, компетентният орган е Комисията за защита на личните данни (КЗЛД), www.cpdp.bg.",
      },
    ],
  },
  {
    id: "deleting-your-account",
    heading: { en: "Deleting your account", bg: "Изтриване на акаунта" },
    paragraphs: [
      {
        en: "When you delete your account (Settings → Danger Zone), your account and profile data, sign-in credentials, and per-user preferences are permanently deleted. We separately record that a deletion happened, in a form that contains no personal data at all — no name, email, phone, address, IP address, browser information, or any profile field — so that we can demonstrate deletion requests are honored without keeping the very data we deleted. This record cannot be used to identify who was deleted.",
        bg: "Когато изтриете акаунта си (Настройки → Опасна зона), вашите акаунт и профилни данни, данни за вход и потребителски предпочитания се изтриват окончателно. Отделно записваме факта, че е извършено изтриване, във форма, която не съдържа никакви лични данни — нито име, имейл, телефон, адрес, IP адрес, информация за браузъра или каквото и да е профилно поле — за да можем да докажем, че заявките за изтриване се изпълняват, без да съхраняваме именно изтритите данни. Този запис не може да се използва за идентифициране на изтритото лице.",
      },
      {
        en: "Deleting your own account does not delete your organization or its plant/telemetry/automation data, since that data belongs to the organization (which may have other members), not to any one account.",
        bg: "Изтриването на собствения ви акаунт не изтрива вашата организация или нейните данни за централи/телеметрия/автоматизация, тъй като тези данни принадлежат на организацията (която може да има други членове), а не на конкретен акаунт.",
      },
    ],
  },
  {
    id: "data-security",
    heading: { en: "Data security", bg: "Сигурност на данните" },
    paragraphs: [
      {
        en: "We apply industry-standard safeguards to protect your data, including encrypted connections, hashed passwords, and access controls that limit which staff can view or act on your account and organization data.",
        bg: "Прилагаме индустриални стандарти за защита на вашите данни, включително криптирани връзки, хеширани пароли и контрол на достъпа, който ограничава кои служители могат да преглеждат или да действат върху вашите данни за акаунт и организация.",
      },
    ],
  },
  {
    id: "childrens-privacy",
    heading: { en: "Children's privacy", bg: "Поверителност на деца" },
    paragraphs: [
      {
        en: "Voltessa is a business-to-business service directed at plant owners and energy professionals. It is not directed at, and we do not knowingly collect personal data from, children.",
        bg: "Voltessa е услуга между предприятия, насочена към собственици на централи и енергийни специалисти. Тя не е насочена към деца и ние съзнателно не събираме лични данни от деца.",
      },
    ],
  },
  {
    id: "changes",
    heading: { en: "Changes to this policy", bg: "Промени в тази политика" },
    paragraphs: [
      {
        en: "If we make a material change to this policy (for example, adding a new category of processing or a new sub-processor), we will update the \"Last updated\" date above and, where the change affects cookie consent, treat any previously recorded consent as expired so you're asked again under the new terms.",
        bg: "Ако направим съществена промяна в тази политика (например добавяне на нова категория обработка или нов подизпълнител), ще актуализираме датата „Последна актуализация\" по-горе и, когато промяната засяга съгласието за бисквитки, ще третираме всяко предходно записано съгласие като изтекло, за да бъдете попитани отново при новите условия.",
      },
    ],
  },
  {
    id: "contact",
    heading: { en: "Contact", bg: "Контакт" },
    paragraphs: [
      {
        en: "Questions about this policy, or requests regarding your personal data, can be sent to privacy@voltessa.ai.",
        bg: "Въпроси относно тази политика или заявки относно вашите лични данни можете да изпращате на privacy@voltessa.ai.",
      },
    ],
  },
];
