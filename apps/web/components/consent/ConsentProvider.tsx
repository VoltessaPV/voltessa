"use client";

import { createContext, useCallback, useContext, useState, useTransition } from "react";
import type { ReactNode } from "react";

import { saveConsent } from "@/lib/consent/actions";
import type { ConsentAction, ConsentChoices } from "@/lib/consent/types";

type ConsentContextValue = {
  /** `null` means no valid decision exists yet (first visit, or a stale/older-version cookie) — see `lib/consent/session.ts`. */
  consent: ConsentChoices | null;
  isBannerOpen: boolean;
  isModalOpen: boolean;
  openPreferences: () => void;
  closeModal: () => void;
  acceptAll: () => void;
  rejectAll: () => void;
  saveCustom: (choices: Omit<ConsentChoices, "necessary">) => void;
  isPending: boolean;
};

const ConsentContext = createContext<ConsentContextValue | null>(null);

export function useConsent(): ConsentContextValue {
  const context = useContext(ConsentContext);

  if (!context) {
    throw new Error("useConsent must be used within a ConsentProvider");
  }

  return context;
}

type ConsentProviderProps = {
  initialConsent: ConsentChoices | null;
  children: ReactNode;
};

/**
 * Mounted once per root layout (the localized tree, admin, and dev each
 * mount their own instance via `components/layout/RootProviders.tsx`) —
 * this is the one place a consent decision is made client-side, always via
 * the `saveConsent` Server Action (`lib/consent/actions.ts`), never a direct
 * `document.cookie` write. Locale/translated text for the banner/modal
 * comes from next-intl's own `useTranslations()`/`useLocale()` directly
 * (reading the ambient `NextIntlClientProvider`) — this provider only
 * tracks consent state, deliberately decoupled from i18n concerns.
 *
 * No implied consent: there is no "dismiss" path that sets `consent` without
 * going through `acceptAll`/`rejectAll`/`saveCustom` — closing the
 * preferences modal without saving leaves `consent` exactly as it was
 * (`null` if this is a first visit, so the banner reappears; unchanged
 * otherwise).
 */
export function ConsentProvider({ initialConsent, children }: ConsentProviderProps) {
  const [consent, setConsent] = useState<ConsentChoices | null>(initialConsent);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const commit = useCallback((action: ConsentAction, choices: ConsentChoices) => {
    setConsent(choices);
    setIsModalOpen(false);

    startTransition(async () => {
      await saveConsent({
        functional: choices.functional,
        analytics: choices.analytics,
        marketing: choices.marketing,
        action,
      });
    });
  }, []);

  const acceptAll = useCallback(
    () => commit("accept_all", { necessary: true, functional: true, analytics: true, marketing: true }),
    [commit],
  );

  const rejectAll = useCallback(
    () => commit("reject_all", { necessary: true, functional: false, analytics: false, marketing: false }),
    [commit],
  );

  const saveCustom = useCallback(
    (choices: Omit<ConsentChoices, "necessary">) => commit("customize", { necessary: true, ...choices }),
    [commit],
  );

  const openPreferences = useCallback(() => setIsModalOpen(true), []);
  const closeModal = useCallback(() => setIsModalOpen(false), []);

  const isBannerOpen = consent === null && !isModalOpen;

  return (
    <ConsentContext.Provider
      value={{
        consent,
        isBannerOpen,
        isModalOpen,
        openPreferences,
        closeModal,
        acceptAll,
        rejectAll,
        saveCustom,
        isPending,
      }}
    >
      {children}
    </ConsentContext.Provider>
  );
}
