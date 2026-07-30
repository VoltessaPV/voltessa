"use client";

import {
  Battery,
  Bell,
  Bot,
  Building2,
  ClipboardList,
  FileClock,
  LayoutDashboard,
  LineChart,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { signOutAction } from "@/lib/auth/actions";

import type { TraderShellContext } from "./AppShell";

const navigation = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "Market",
    href: "/market",
    icon: LineChart,
  },
  {
    label: "BESS",
    href: "/bess",
    icon: Battery,
  },
  {
    label: "Automations",
    href: "/automations",
    icon: Bot,
  },
  {
    label: "Alerts",
    href: "/alerts",
    icon: Bell,
  },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
  },
];

/**
 * Trader Workspace milestone. Its own explicit order (Dashboard, Clients,
 * Market, Automations, Alerts, BESS, Settings) - not derived from
 * `navigation` above, since it isn't a subset/reordering of the owner nav
 * anymore (Clients has no owner-side equivalent, and BESS moves relative
 * to Automations/Alerts). Settings is included - a Trader manages their
 * own profile there, same page Plant Owners use for theirs. Plants and
 * Administration stay Plant Owner / Platform Admin only.
 */
const traderNavigation = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Clients", href: "/clients", icon: Users },
  { label: "Market", href: "/market", icon: LineChart },
  { label: "Automations", href: "/automations", icon: Bot },
  { label: "Alerts", href: "/alerts", icon: Bell },
  { label: "BESS", href: "/bess", icon: Battery },
  { label: "Settings", href: "/settings", icon: Settings },
];

/** Platform Administration milestone — only ever rendered when `isPlatformAdmin`. See ADR-014. */
const adminNavigation = [
  {
    label: "Dashboard",
    href: "/admin",
    icon: LayoutDashboard,
  },
  {
    label: "Users",
    href: "/admin/users",
    icon: Users,
  },
  {
    label: "Plant Owners",
    href: "/admin/plant-owners",
    icon: Building2,
  },
  {
    label: "Energy Traders",
    href: "/admin/traders",
    icon: LineChart,
  },
  {
    label: "Assignments",
    href: "/admin/assignments",
    icon: ClipboardList,
  },
  {
    label: "Audit Log",
    href: "/admin/audit-log",
    icon: FileClock,
  },
];

/** Shared nav-link list — identical markup for the fixed desktop sidebar and the mobile drawer, so a link's look never has to be maintained twice. */
function SidebarNav({
  onNavigate,
  isPlatformAdmin,
  trader,
}: {
  onNavigate?: () => void;
  isPlatformAdmin: boolean;
  trader?: TraderShellContext;
}) {
  const items = trader ? traderNavigation : navigation;

  return (
    <nav className="space-y-1 px-3 py-4">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          onClick={onNavigate}
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-white/70 transition hover:bg-white/5 hover:text-white"
        >
          <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          {item.label}
        </Link>
      ))}

      {!trader && isPlatformAdmin && (
        <div className="mt-4 border-t border-white/10 pt-4">
          <div className="flex items-center gap-2 px-3 pb-2 text-xs font-medium uppercase tracking-wider text-white/40">
            <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} />
            Administration
          </div>

          {adminNavigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-white/70 transition hover:bg-white/5 hover:text-white"
            >
              <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}

/**
 * The primary Sign Out entry point - was only reachable via the header's
 * user dropdown (easy to miss), now a real nav item styled identically to
 * `SidebarNav`'s own links, directly below them behind a divider, in both
 * the desktop sidebar and the mobile drawer. `UserMenu`'s dropdown keeps
 * its own Sign Out item too - harmless redundancy, not removed.
 */
function SignOutNavItem() {
  return (
    <div className="border-t border-white/10 px-3 py-4">
      <form action={signOutAction}>
        <button
          type="submit"
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-white/70 transition hover:bg-white/5 hover:text-white"
        >
          <LogOut className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          Sign Out
        </button>
      </form>
    </div>
  );
}

/**
 * Responsive AppSidebar (Responsive Design Sprint). Desktop (`lg:` and up)
 * is pixel-identical to before: the same fixed 256px `<aside>`, same
 * classes, always visible — per the sprint's "desktop must remain visually
 * unchanged" requirement, this component only ever *adds* `hidden lg:block`
 * to gate it, nothing about its own markup/classes changed.
 *
 * Below `lg`, that fixed sidebar is hidden entirely (there is no room for
 * an always-visible 256px rail on a phone) and replaced by a fixed
 * hamburger trigger + slide-in drawer, both scoped to this one component so
 * `AppShell`/`AppHeader` need no cross-component state to support it.
 */
export function AppSidebar({
  isPlatformAdmin,
  trader,
}: {
  isPlatformAdmin: boolean;
  trader?: TraderShellContext;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 overflow-y-auto border-r border-white/10 bg-[#070B18] lg:block">
        <div className="flex h-16 items-center border-b border-white/10 px-6">
          <span className="text-lg font-semibold">Voltessa</span>
        </div>

        <SidebarNav isPlatformAdmin={isPlatformAdmin} trader={trader} />

        <SignOutNavItem />
      </aside>

      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label="Open navigation menu"
        className="fixed left-3 top-3 z-40 flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-[#070B18] text-white/80 transition hover:text-white lg:hidden"
      >
        <Menu className="h-5 w-5" strokeWidth={1.75} />
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />

          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-white/10 bg-[#070B18]">
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 px-4">
              <span className="text-lg font-semibold">Voltessa</span>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Close navigation menu"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/5 hover:text-white"
              >
                <X className="h-5 w-5" strokeWidth={1.75} />
              </button>
            </div>

            <SidebarNav
              onNavigate={() => setIsOpen(false)}
              isPlatformAdmin={isPlatformAdmin}
              trader={trader}
            />

            <SignOutNavItem />
          </aside>
        </div>
      )}
    </>
  );
}
