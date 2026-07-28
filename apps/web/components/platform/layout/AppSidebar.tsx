"use client";

import { Bell, Bot, LayoutDashboard, LineChart, LogOut, Menu, Settings, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { signOutAction } from "@/lib/auth/actions";

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

/** Shared nav-link list — identical markup for the fixed desktop sidebar and the mobile drawer, so a link's look never has to be maintained twice. */
function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="space-y-1 px-3 py-4">
      {navigation.map((item) => (
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
    </nav>
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
export function AppSidebar() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-white/10 bg-[#070B18] lg:block">
        <div className="flex h-16 items-center border-b border-white/10 px-6">
          <span className="text-lg font-semibold">Voltessa</span>
        </div>

        <SidebarNav />
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

            <SidebarNav onNavigate={() => setIsOpen(false)} />

            <div className="mt-auto shrink-0 border-t border-white/10 p-3">
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-white/70 transition hover:bg-white/5 hover:text-white"
                >
                  <LogOut className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  Sign out
                </button>
              </form>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
