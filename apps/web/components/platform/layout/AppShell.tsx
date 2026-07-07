import type { ReactNode } from "react";

import { AppHeader } from "./AppHeader";
import { AppSidebar } from "./AppSidebar";

type AppShellProps = {
  children: ReactNode;
  user: {
    name: string | null;
    email: string | null;
    role: string;
  };
  organization: {
    name: string;
  };
};

export function AppShell({
  children,
  user,
  organization,
}: AppShellProps) {
  return (
    <div className="min-h-screen bg-[#050816] text-white">
      <AppSidebar organizationName={organization.name} />

      <div className="min-h-screen pl-64">
        <AppHeader user={user} />

        <main className="p-6">
          {children}
        </main>
      </div>
    </div>
  );
}