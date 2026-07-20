import { Bell, Bot, LayoutDashboard, LineChart, Settings } from "lucide-react";
import Link from "next/link";

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

export function AppSidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 w-56 border-r border-white/10 bg-[#070B18]">
      <div className="flex h-16 items-center border-b border-white/10 px-6">
        <span className="text-lg font-semibold">
          Voltessa
        </span>
      </div>

      <nav className="space-y-1 px-3 py-4">
        {navigation.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-white/70 transition hover:bg-white/5 hover:text-white"
          >
            <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}