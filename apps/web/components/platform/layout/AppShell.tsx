import type { ReactNode } from "react";

import { AppHeader } from "./AppHeader";
import { AppSidebar } from "./AppSidebar";

type AppShellProps = {
  children: ReactNode;
  /** Passed straight through to AppHeader - see that component's doc comment. */
  eyebrow: string;
  title: string;
  user: {
    name: string | null;
    email: string | null;
    role: string;
  };
};

export function AppShell({ children, eyebrow, title, user }: AppShellProps) {
  return (
    <div className="min-h-screen bg-[#050816] text-white">
      <AppSidebar />

      <div className="min-h-screen pl-64">
        <AppHeader eyebrow={eyebrow} title={title} user={user} />

        <main className="pt-0 pr-6 pb-6 pl-12">{children}</main>
      </div>
    </div>
  );
}
