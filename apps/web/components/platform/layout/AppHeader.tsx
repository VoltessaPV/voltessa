import { getTranslations } from "next-intl/server";

import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";

import { ClientSwitchLink } from "./ClientSwitchLink";
import { PageHeading } from "./PageHeading";
import { UserMenu } from "./UserMenu";
import type { TraderShellContext } from "./AppShell";

type AppHeaderProps = {
  user: {
    name: string | null;
    email: string | null;
    role: string;
  };
  /** Trader Workspace milestone. Present only for an Energy Trader session - renders the persistent client-context indicator. */
  trader?: TraderShellContext;
};

/** Display-only formatting - `user.role` itself stays the raw Role enum value used for permission checks everywhere else. */
function displayRole(role: string): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

/**
 * Trader Workspace milestone. Always shows both pieces of context at
 * once - which client (if any) is currently selected, and how many the
 * trader is assigned to in total - so the trader never has to guess either
 * from a page's content alone, no matter how large their portfolio is.
 */
async function ClientContextIndicator({ trader }: { trader: TraderShellContext }) {
  const t = await getTranslations("clients.header");
  const clientCountLabel =
    trader.assignedClientCount === 1
      ? t("portfolioCountSingular", { count: trader.assignedClientCount })
      : t("portfolioCountPlural", { count: trader.assignedClientCount });

  return (
    <div className="flex items-center gap-3 text-sm text-white/70">
      <span className="hidden sm:inline">
        {trader.currentClientName ? (
          <>
            {t("viewing")} <span className="font-medium text-white">{trader.currentClientName}</span>
          </>
        ) : (
          t("noClientSelected")
        )}
        <span className="text-white/30"> · </span>
        {clientCountLabel}
      </span>

      {trader.assignedClientCount > 0 && <ClientSwitchLink />}
    </div>
  );
}

export async function AppHeader({ user, trader }: AppHeaderProps) {
  return (
    <header className="flex h-16 items-center justify-between gap-3 border-b border-white/10 pl-16 pr-4 lg:px-6">
      <div className="min-w-0 flex-1">
        <PageHeading />
      </div>

      {trader && <ClientContextIndicator trader={trader} />}

      <div className="hidden sm:block">
        <LanguageSwitcher />
      </div>

      <UserMenu name={user.name ?? user.email ?? "User"} role={displayRole(user.role)} />
    </header>
  );
}
