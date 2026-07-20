import Link from "next/link";

const navigation = [
  {
    label: "Dashboard",
    href: "/dashboard",
  },
  {
    label: "Market",
    href: "/market",
  },
  {
    label: "Automations",
    href: "/automations",
  },
  {
    label: "Alerts",
    href: "/alerts",
  },
  {
    label: "Settings",
    href: "/settings",
  },
];

export function AppSidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 w-64 border-r border-white/10 bg-[#070B18]">
      <div className="flex h-16 items-center border-b border-white/10 px-6">
        <span className="text-lg font-semibold">
          Voltessa
        </span>
      </div>

      <nav className="space-y-1 px-4 py-4">
        {navigation.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="block rounded-lg px-3 py-2 text-sm text-white/70 transition hover:bg-white/5 hover:text-white"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}