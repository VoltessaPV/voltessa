import type { ReactNode } from "react";

import { requirePlatformAdmin } from "@/lib/auth/session";

type Props = {
  children: ReactNode;
};

/**
 * Defense in depth on top of the sidebar's own conditional rendering — a
 * non-admin who navigates here directly gets `forbidden()` (403), never a
 * silently-rendered page. Every Server Action under `admin/actions.ts`
 * re-checks `requirePlatformAdmin()` itself too, since a layout render
 * never protects a Server Action's own RPC.
 */
export default async function AdminLayout({ children }: Props) {
  await requirePlatformAdmin();

  return <>{children}</>;
}
