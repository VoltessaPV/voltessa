"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Trader Workspace milestone. The one small client component this
 * milestone needs (same "narrow, deliberate `use client`" convention as
 * `RefreshButton`/`HuaweiControlCard`) - a Server Component layout can't
 * know which page it's rendering inside, but selecting a client is meant
 * to be a context switch, not a page navigation (per the architecture
 * decision), so this link has to carry the trader's current path through
 * to the Clients page as `?returnTo=`, which `selectTraderOrganization`
 * then redirects back to (after validating it against a fixed allow-list -
 * see `resolveTraderRedirectTarget`) once a client is picked.
 */
export function ClientSwitchLink() {
  const pathname = usePathname();

  return (
    <Link
      href={`/clients?returnTo=${encodeURIComponent(pathname)}`}
      className="text-xs font-medium text-blue-400 transition hover:text-blue-300"
    >
      Switch client
    </Link>
  );
}
