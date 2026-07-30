import type { ReactNode } from "react";

import { AppHeader } from "./AppHeader";
import { AppSidebar } from "./AppSidebar";

export type TraderShellContext = {
  /** Null when this trader has no client selected (zero assignments). */
  currentClientName: string | null;
  assignedClientCount: number;
};

type AppShellProps = {
  children: ReactNode;
  user: {
    name: string | null;
    email: string | null;
    role: string;
    isPlatformAdmin: boolean;
  };
  /** Trader Workspace milestone. Present only for an Energy Trader session - drives AppSidebar's Administration gating and AppHeader's client-context indicator. */
  trader?: TraderShellContext;
};

export function AppShell({ children, user, trader }: AppShellProps) {
  return (
    <div className="min-h-screen bg-[#050816] text-white">
      <AppSidebar isPlatformAdmin={user.isPlatformAdmin} trader={trader} />

      <div className="min-h-screen lg:pl-64">
        <AppHeader user={user} trader={trader} />

        <main className="p-3 sm:p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
