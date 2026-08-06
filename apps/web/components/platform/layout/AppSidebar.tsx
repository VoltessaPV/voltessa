"use client";

import {
  Activity,
  Battery,
  Bell,
  Bot,
  Building2,
  CalendarClock,
  ClipboardList,
  FileClock,
  FlaskConical,
  LayoutDashboard,
  Layers,
  LineChart,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import NextLink from "next/link";
import { Link } from "@/lib/i18n/navigation";
import { useState } from "react";

import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { signOutAction } from "@/lib/auth/actions";

import type { TraderShellContext } from "./AppShell";

/**
 * Full Internationalization milestone: labels come from `useTranslations`
 * (called inside the components below, not here) — these two builder
 * functions take the resolved translator functions so the nav item arrays
 * stay data, not JSX, matching the pre-i18n shape exactly.
 */
function buildNavigation(t: ReturnType<typeof useTranslations<"navigation.sidebar">>, tTerm: ReturnType<typeof useTranslations<"terminology">>) {
  return [
    { label: tTerm("dashboard"), href: "/dashboard", icon: LayoutDashboard },
    { label: tTerm("market"), href: "/market", icon: LineChart },
    { label: t("bessLink"), href: "/bess", icon: Battery },
    { label: t("automationsLink"), href: "/automations", icon: Bot },
    { label: t("alertsLink"), href: "/alerts", icon: Bell },
    { label: tTerm("settings"), href: "/settings", icon: Settings },
  ];
}

/**
 * Trader Workflow Simplification milestone. Clients is the Trader's home -
 * the portfolio overview (assigned-client KPIs + the client grid) lives
 * there now, so it leads the nav. Everything after Dashboard then mirrors
 * the Plant Owner nav's own order exactly (Market, BESS, Automations,
 * Alerts, Settings) - Dashboard/Market/BESS/Automations/Alerts all resolve
 * the same currently-selected client a Trader picked on Clients, matching
 * `buildNavigation` above item-for-item past the Clients entry. Settings is
 * included - a Trader manages their own profile there, same page Plant
 * Owners use for theirs. Plants and Administration stay Plant Owner /
 * Platform Admin only.
 */
function buildTraderNavigation(t: ReturnType<typeof useTranslations<"navigation.sidebar">>, tTerm: ReturnType<typeof useTranslations<"terminology">>) {
  return [
    { label: t("clientsLink"), href: "/clients", icon: Users },
    { label: tTerm("dashboard"), href: "/dashboard", icon: LayoutDashboard },
    { label: tTerm("market"), href: "/market", icon: LineChart },
    { label: t("bessLink"), href: "/bess", icon: Battery },
    { label: t("automationsLink"), href: "/automations", icon: Bot },
    { label: t("alertsLink"), href: "/alerts", icon: Bell },
    { label: tTerm("settings"), href: "/settings", icon: Settings },
  ];
}

/**
 * Platform Administration milestone — only ever rendered when
 * `isPlatformAdmin`. Full Internationalization milestone: deliberately
 * NEVER translated, even though this component is shared with the
 * localized platform tree — "Platform Admin remains English-only" and
 * "Admin navigation" is explicitly named as out of scope. Fixed English
 * literals, matching `/admin`'s own English-pinned layout. See ADR-014.
 *
 * These hrefs are rendered with plain `next/link` (`NextLink` below), never
 * the locale-aware `Link` from `lib/i18n/navigation` used for every other
 * nav item in this file — that Link automatically prepends the current
 * locale to whatever href it's given, which silently turned `/admin` into
 * `/en/admin` (a route that doesn't exist - `/admin` is its own root,
 * physically outside `app/[locale]/`, so that 404s) the one time this used
 * the wrong Link. `/admin/*` must render byte-for-byte as typed, regardless
 * of which locale the surrounding (customer-facing) sidebar is in.
 */
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
  {
    label: "Operations",
    href: "/admin/operations",
    icon: Activity,
  },
  {
    label: "Historical Imports",
    href: "/admin/historical-imports",
    icon: CalendarClock,
  },
  {
    label: "Automation Lab",
    href: "/admin/automation-lab",
    icon: FlaskConical,
  },
  {
    label: "Digital Twin",
    href: "/admin/digital-twin",
    icon: Layers,
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
  const t = useTranslations("navigation.sidebar");
  const tTerm = useTranslations("terminology");
  const items = trader ? buildTraderNavigation(t, tTerm) : buildNavigation(t, tTerm);

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
            <NextLink
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-white/70 transition hover:bg-white/5 hover:text-white"
            >
              <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              {item.label}
            </NextLink>
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
  const t = useTranslations("navigation.sidebar");

  return (
    <div className="border-t border-white/10 px-3 py-4">
      <form action={signOutAction}>
        <button
          type="submit"
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-white/70 transition hover:bg-white/5 hover:text-white"
        >
          <LogOut className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          {t("signOutLink")}
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
  const t = useTranslations("navigation.sidebar");

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
        aria-label={t("openMenuLabel")}
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
                aria-label={t("closeMenuLabel")}
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

            {/* Mobile-only: AppHeader's own switcher is hidden below `sm`, so the drawer is this control's only reachable home on small screens. */}
            <div className="px-3 py-2">
              <LanguageSwitcher className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-1 text-xs" />
            </div>

            <SignOutNavItem />
          </aside>
        </div>
      )}
    </>
  );
}
