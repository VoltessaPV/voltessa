import { cookies } from "next/headers";

import { CONSENT_COOKIE_NAME, CONSENT_VERSION } from "./constants";
import type { ConsentPayload } from "./types";

/**
 * Server-side consent read, mirroring `lib/auth/session.ts`'s pattern for
 * the same reason: this is the one place that decides "has this visitor
 * actually consented, under the terms currently in force" — every Server
 * Component that needs to conditionally render a `<Script>` tag (a future
 * GA4/Clarity/Meta Pixel integration) or gate a third-party embed (Calendly)
 * reads through here, never `cookies()` directly.
 *
 * A stored consent from an older `CONSENT_VERSION` is treated as absent
 * (returns `null`) rather than partially honored — the banner reappears and
 * the visitor consents again under the current categories/disclosures. A
 * malformed cookie value (never expected, but not worth crashing a page
 * render over) is treated the same way.
 */
export async function getConsent(): Promise<ConsentPayload | null> {
  const store = await cookies();
  const raw = store.get(CONSENT_COOKIE_NAME)?.value;

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as ConsentPayload;

    if (parsed.version !== CONSENT_VERSION) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export async function hasConsentFor(
  category: "functional" | "analytics" | "marketing",
): Promise<boolean> {
  const consent = await getConsent();
  return consent?.[category] === true;
}
