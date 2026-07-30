import type { ReactNode } from "react";

import { AppHeader } from "./AppHeader";
import { AppSidebar } from "./AppSidebar";

export type TraderShellContext = {
  organizations: { id: string; name: string }[];
  selectedOrganizationId: string;
};

type AppShellProps = {
  children: ReactNode;
  user: {
    name: string | null;
    email: string | null;
    role: string;
    isPlatformAdmin: boolean;
  };
  /** Trader Self-Service Onboarding milestone. Present only for an Energy Trader session - drives AppSidebar's trader-scoped nav and org switcher. */
  trader?: TraderShellContext;
};

export function AppShell({ children, user, trader }: AppShellProps) {
  return (
    <div className="min-h-screen bg-[#050816] text-white">
      <AppSidebar isPlatformAdmin={user.isPlatformAdmin} trader={trader} />

      <div className="min-h-screen lg:pl-64">
        <AppHeader user={user} />

        <main className="p-3 sm:p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
