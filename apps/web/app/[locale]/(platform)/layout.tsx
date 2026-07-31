import type { ReactNode } from "react";

import { AppShell } from "@/components/platform/layout/AppShell";
import {
  requireCurrentUser,
  requireOnboardedUser,
  requireTraderOrganizationAccess,
} from "@/lib/auth/session";

type Props = {
  children: ReactNode;
};

/**
 * Trader Workspace milestone. Branches by `accountType` before deciding how
 * to resolve organization access - deliberately NOT a change to
 * `requireOnboardedUser()` itself, which stays exactly what it always was
 * (ownership via `User.organizationId`). Every page that still calls
 * `requireOnboardedUser()`/`requirePermission()` directly (Plants,
 * Settings, Administration, and anything else not explicitly updated for
 * this milestone) keeps rejecting a Trader automatically, with zero
 * changes to those pages - this layout only grants entry to the shared
 * shell; each page underneath still enforces its own access level.
 */
export default async function PlatformLayout({ children }: Props) {
  const identity = await requireCurrentUser();

  if (identity.accountType === "ENERGY_TRADER") {
    const access = await requireTraderOrganizationAccess();

    return (
      <AppShell
        user={{
          name: access.trader.name,
          email: access.trader.email,
          role: access.trader.role,
          isPlatformAdmin: access.trader.isPlatformAdmin,
        }}
        trader={{
          currentClientName: access.organization?.name ?? null,
          assignedClientCount: access.assignedOrganizations.length,
        }}
      >
        {children}
      </AppShell>
    );
  }

  const user = await requireOnboardedUser();

  return (
    <AppShell
      user={{
        name: user.name,
        email: user.email,
        role: user.role,
        isPlatformAdmin: user.isPlatformAdmin,
      }}
    >
      {children}
    </AppShell>
  );
}
