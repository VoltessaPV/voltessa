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
};

export function AppShell({
  children,
  user,
}: AppShellProps) {
  return (
    <div className="min-h-screen bg-[#050816] text-white">
      <AppSidebar />

      <div className="min-h-screen pl-64">
        <AppHeader user={user} />

        <main className="pt-0 pr-6 pb-6 pl-6">
          {children}
        </main>
      </div>
    </div>
  );
}