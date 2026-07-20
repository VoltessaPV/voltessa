import type { ReactNode } from "react";

import { requireOnboardedUser } from "@/lib/auth/session";

type Props = {
  children: ReactNode;
};

/**
 * Auth/onboarding gate only - `AppShell` (sidebar + header, now including
 * the page's own eyebrow/title) is rendered by each page itself instead of
 * here, since a shared layout has no way to receive a value from the page
 * it wraps (Fixed Header Architecture milestone). This still protects every
 * `/dashboard`, `/market`, etc. route exactly as before.
 */
export default async function PlatformLayout({ children }: Props) {
  await requireOnboardedUser();

  return children;
}
