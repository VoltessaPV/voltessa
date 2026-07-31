/**
 * Voltessa's data-retention schedule — GDPR + Cookie Consent Platform
 * milestone. Single source of truth, read by the Privacy Policy's
 * retention section so the policy and this schedule can never contradict
 * each other. `docs/legal/data-retention.md` is the human-readable mirror
 * of this exact data for internal/legal reference — if you change a value
 * here, update that document too (it is not auto-generated from this file).
 *
 * Periods reflect an explicit decision for this milestone (see the GDPR +
 * Cookie Consent Platform milestone conversation), except where noted
 * otherwise below.
 */
export type RetentionEntry = {
  id: string;
  category: { en: string; bg: string };
  retention: { en: string; bg: string };
  basis: { en: string; bg: string };
};

export const DATA_RETENTION_SCHEDULE: RetentionEntry[] = [
  {
    id: "account",
    category: {
      en: "Account and profile data (name, email, phone, organization membership, role)",
      bg: "Данни за акаунта и профила (име, имейл, телефон, членство в организация, роля)",
    },
    retention: {
      en: "Until you delete your account.",
      bg: "До изтриване на акаунта от вас.",
    },
    basis: {
      en: "Necessary to provide the service to you (performance of a contract).",
      bg: "Необходимо за предоставяне на услугата (изпълнение на договор).",
    },
  },
  {
    id: "billing",
    category: {
      en: "Organization billing/invoicing details",
      bg: "Данни за фактуриране на организацията",
    },
    retention: {
      en: "Until account deletion, except that specific financial or accounting records may need to be kept for longer where required by Bulgarian accounting and tax legislation (the Accountancy Act and the Tax-Insurance Procedure Code) — in that case, those specific records are kept for the legally required period instead.",
      bg: "До изтриване на акаунта, освен ако конкретни финансови или счетоводни документи не трябва да се съхраняват за по-дълъг срок съгласно българското счетоводно и данъчно законодателство (Закона за счетоводството и Данъчно-осигурителния процесуален кодекс) — в такъв случай тези документи се съхраняват за законоустановения срок.",
    },
    basis: {
      en: "Necessary to provide the service; compliance with a legal obligation where applicable.",
      bg: "Необходимо за предоставяне на услугата; спазване на законово задължение, когато е приложимо.",
    },
  },
  {
    id: "plant-telemetry",
    category: {
      en: "Plant operational and telemetry data (device readings, daily production/consumption figures)",
      bg: "Оперативни данни и телеметрия за централата (показания на устройства, дневни стойности за производство/потребление)",
    },
    retention: {
      en: "For as long as your FusionSolar connection is active, and for up to 12 months after the connection is disconnected or your account is deleted — unless a longer period is required by law or you ask us to keep it for longer.",
      bg: "Докато вашата връзка с FusionSolar е активна, и до 12 месеца след прекратяване на връзката или изтриване на акаунта — освен ако по-дълъг срок не се изисква от закона или вие поискате по-дълго съхранение.",
    },
    basis: {
      en: "Necessary to provide the service; legitimate interest in supporting you after you leave.",
      bg: "Необходимо за предоставяне на услугата; легитимен интерес за оказване на съдействие след прекратяване.",
    },
  },
  {
    id: "market-data",
    category: {
      en: "Public electricity market price data",
      bg: "Публични данни за цени на електроенергийния пазар",
    },
    retention: {
      en: "Indefinite — this is public market data, not personal data.",
      bg: "Безсрочно — това са публични пазарни данни, не лични данни.",
    },
    basis: {
      en: "Not personal data.",
      bg: "Не са лични данни.",
    },
  },
  {
    id: "automation-events",
    category: {
      en: "Automation decision log (export-mode changes, failures, reconciliation events)",
      bg: "Дневник на решенията на автоматизацията (промени в режима на износ, грешки, събития от синхронизация)",
    },
    retention: {
      en: "24 months.",
      bg: "24 месеца.",
    },
    basis: {
      en: "Legitimate interest in being able to explain and audit automated decisions affecting your plant.",
      bg: "Легитимен интерес за възможност за обяснение и одит на автоматизираните решения, засягащи вашата централа.",
    },
  },
  {
    id: "audit-log",
    category: {
      en: "Administrative audit log (Platform Administration actions)",
      bg: "Административен одитен дневник (действия на Platform Administration)",
    },
    retention: {
      en: "24 months.",
      bg: "24 месеца.",
    },
    basis: {
      en: "Legitimate interest in security and accountability for administrative actions.",
      bg: "Легитимен интерес за сигурност и отчетност на административните действия.",
    },
  },
  {
    id: "consent-log",
    category: {
      en: "Cookie/consent decision history",
      bg: "История на решенията за съгласие за бисквитки",
    },
    retention: {
      en: "24 months per recorded decision. We keep every individual consent decision for its own 24-month period rather than discarding earlier decisions when you update your preferences, so we can demonstrate what you consented to and when.",
      bg: "24 месеца за всяко записано решение. Съхраняваме всяко отделно решение за съгласие за собствен 24-месечен период, вместо да изтриваме предишните решения при промяна на настройките, за да можем да докажем на какво и кога сте се съгласили.",
    },
    basis: {
      en: "Legal obligation to demonstrate consent was validly obtained (GDPR accountability principle).",
      bg: "Законово задължение за доказване на валидно получено съгласие (принцип на отчетност по ОРЗД).",
    },
  },
  {
    id: "impersonation",
    category: {
      en: "Support impersonation sessions (Platform Admin support access)",
      bg: "Сесии за поддръжка чрез импersonation (достъп за поддръжка на Platform Admin)",
    },
    retention: {
      en: "24 months.",
      bg: "24 месеца.",
    },
    basis: {
      en: "Legitimate interest in security and accountability for support access to your account.",
      bg: "Легитимен интерес за сигурност и отчетност на достъпа за поддръжка до вашия акаунт.",
    },
  },
  {
    id: "email-verification-token",
    category: {
      en: "Email verification tokens",
      bg: "Токени за потвърждение на имейл",
    },
    retention: {
      en: "24 hours, or until used, whichever is sooner (existing technical expiry).",
      bg: "24 часа или до използване, което от двете настъпи по-рано (съществуващ технически срок).",
    },
    basis: {
      en: "Necessary for account security.",
      bg: "Необходимо за сигурността на акаунта.",
    },
  },
  {
    id: "password-reset-token",
    category: {
      en: "Password reset tokens",
      bg: "Токени за възстановяване на парола",
    },
    retention: {
      en: "60 minutes, or until used, whichever is sooner (existing technical expiry).",
      bg: "60 минути или до използване, което от двете настъпи по-рано (съществуващ технически срок).",
    },
    basis: {
      en: "Necessary for account security.",
      bg: "Необходимо за сигурността на акаунта.",
    },
  },
  {
    id: "deletion-audit-record",
    category: {
      en: "Deleted-account audit record",
      bg: "Одитен запис за изтрит акаунт",
    },
    retention: {
      en: "Indefinite. This record contains no personal data — see the Privacy Policy's \"Deleting your account\" section — so the standard time limits above do not apply to it.",
      bg: "Безсрочно. Този запис не съдържа лични данни — вижте секция „Изтриване на акаунта\" в Политиката за поверителност — поради което горните срокове не се прилагат за него.",
    },
    basis: {
      en: "Legal obligation to demonstrate that a deletion request was honored (accountability), without retaining the personal data that was deleted.",
      bg: "Законово задължение за доказване, че заявка за изтриване е изпълнена (отчетност), без да се съхраняват изтритите лични данни.",
    },
  },
];
