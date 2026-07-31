export const CONSENT_COOKIE_NAME = "voltessa-consent";

/**
 * Bump this whenever the consent categories or the set of third parties
 * disclosed in the Cookie Policy changes. Any stored consent recorded under
 * an older version is treated as absent (see `lib/consent/session.ts`) — the
 * banner reappears and consent must be given again under the current terms.
 */
export const CONSENT_VERSION = 1;

/** ~6 months, per the agreed data-retention/consent-validity policy (docs/legal/data-retention.md). */
export const CONSENT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30 * 6;

export const LOCALE_COOKIE_NAME = "voltessa-locale";
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
