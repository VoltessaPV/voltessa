import type { ReactNode } from "react";

import { AppShell } from "@/components/platform/layout/AppShell";
import { requireOnboardedUser } from "@/lib/auth/session";

type Props = {
  children: ReactNode;
};

export default async function PlatformLayout({
  children,
}: Props) {
  const user = await requireOnboardedUser();

  return (
    <AppShell
      user={{
        name: user.name,
        email: user.email,
        role: user.role,
      }}
    >
      {children}
    </AppShell>
  );
}
