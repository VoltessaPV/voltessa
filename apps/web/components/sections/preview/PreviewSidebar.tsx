"use client";

import { Battery, Bell, Bot, LayoutDashboard, LineChart } from "lucide-react";

/**
 * A dedicated, marketing-only visual copy of `components/platform/layout/
 * AppSidebar.tsx` — same layout, spacing, typography, icon treatment, and
 * colors, but deliberately NOT that component: no `next/link`, no
 * `usePathname`, no auth, no router navigation. This sidebar only ever
 * switches local state inside the hero's browser mockup
 * (`PlatformPreview.tsx`) — the browser window itself never navigates away
 * from the landing page. Intentionally a one-time snapshot of the real
 * sidebar's look, not a shared component; a future change to the real
 * `AppSidebar` has no reason to appear here automatically.
 */

export type PreviewKey = "dashboard" | "market" | "bess" | "automations" | "alerts";

const NAVIGATION: Array<{ key: PreviewKey; label: string; icon: typeof LayoutDashboard }> = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "market", label: "Market", icon: LineChart },
  { key: "bess", label: "BESS", icon: Battery },
  { key: "automations", label: "Automations", icon: Bot },
  { key: "alerts", label: "Alerts", icon: Bell },
];

type PreviewSidebarProps = {
  active: PreviewKey;
  onSelect: (key: PreviewKey) => void;
};

export function PreviewSidebar({ active, onSelect }: PreviewSidebarProps) {
  return (
    <aside className="w-64 shrink-0 border-r border-white/10 bg-[#070B18]">
      <div className="flex h-16 items-center border-b border-white/10 px-6">
        <span className="text-lg font-semibold text-white">Voltessa</span>
      </div>

      <nav className="space-y-1 px-3 py-4">
        {NAVIGATION.map((item) => {
          const isActive = item.key === active;

          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelect(item.key)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition ${
                isActive ? "bg-white/5 text-white" : "text-white/70 hover:bg-white/5 hover:text-white"
              }`}
            >
              <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              {item.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
