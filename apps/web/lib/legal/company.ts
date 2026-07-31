/**
 * Single source of truth for Voltessa's legal entity information — GDPR +
 * Cookie Consent Platform milestone. Every legal/compliance surface (Privacy
 * Policy, Cookie Policy, Terms of Service, the Company Information page,
 * footer links, and any consent dialog) must read from here; this
 * information must never be re-typed anywhere else in the codebase.
 *
 * Values below were provided directly by the company (not inferred/guessed —
 * see the GDPR + Cookie Consent Platform milestone conversation).
 */
export const COMPANY = {
  legalName: "Consensu EOOD",
  tradingName: "Voltessa",

  /** Bulgarian Unified Identification Code ("ЕИК"). */
  registrationNumber: "207238821",

  registeredAddress: {
    street: "Pozitano Str. 14",
    city: "Sofia",
    postalCode: "1301",
    country: "Bulgaria",
  },

  privacyEmail: "privacy@voltessa.ai",
  supportEmail: "support@voltessa.ai",
  websiteUrl: "https://voltessa.ai",

  /** Governing law for Terms of Service and the data-protection regime that applies (the company is Bulgarian-registered). */
  governingLaw: "Bulgaria",

  /** The competent supervisory authority for GDPR complaints, given the company's Bulgarian registration. */
  supervisoryAuthority: {
    name: "Commission for Personal Data Protection",
    nameBg: "Комисия за защита на личните данни",
    abbreviation: "CPDP",
    url: "https://www.cpdp.bg",
  },
} as const;

export type Company = typeof COMPANY;
