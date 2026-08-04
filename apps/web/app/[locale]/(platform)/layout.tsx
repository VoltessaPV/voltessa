import type { ReactNode } from "react";

import { stopImpersonation } from "@/app/admin/actions";
import { AppShell } from "@/components/platform/layout/AppShell";
import { resolveActiveImpersonation } from "@/lib/auth/impersonation";
import {
  requireCurrentUser,
  requireOnboardedUser,
  requireTraderOrganizationAccess,
} from "@/lib/auth/session";

type Props = {
  children: ReactNode;
};

/**
 * The one deliberate exception to "no page should know whether
 * impersonation is active" (Multi-Tenant Audit + Impersonation milestone):
 * chrome, not business logic - it renders above whatever the impersonated
 * page itself returns, using the exact same `resolveActiveImpersonation()`
 * check `getCurrentUser()` uses, so it can never show for one but not the
 * other. `stopImpersonation` doesn't need the target's permission to run -
 * see its own doc comment in `app/admin/actions.ts`.
 */
async function ImpersonationBanner() {
  const impersonation = await resolveActiveImpersonation();
  if (!impersonation) {
    return null;
  }

  return (
    <form
      action={stopImpersonation}
      className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-200"
    >
      <span>
        Impersonating{" "}
        <span className="font-medium">
          {impersonation.targetName ?? impersonation.targetEmail ?? "Unknown user"}
        </span>
      </span>
      <button
        type="submit"
        className="rounded-lg border border-amber-300/40 px-3 py-1 font-medium text-amber-100 transition hover:bg-amber-400/20"
      >
        Stop impersonating
      </button>
    </form>
  );
}

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
        <ImpersonationBanner />
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
      <ImpersonationBanner />
      {children}
    </AppShell>
  );
}
