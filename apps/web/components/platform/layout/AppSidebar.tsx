import Link from "next/link";

type AppSidebarProps = {
  organizationName: string;
};

const navigation = [
  {
    label: "Dashboard",
    href: "/dashboard",
  },
  {
    label: "Plants",
    href: "/plants",
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

export function AppSidebar({
  organizationName,
}: AppSidebarProps) {
  return (
    <aside className="fixed inset-y-0 left-0 w-64 border-r border-white/10 bg-[#070B18]">
      <div className="flex h-16 items-center border-b border-white/10 px-6">
        <span className="text-lg font-semibold">
          Voltessa
        </span>
      </div>

      <div className="px-4 py-5">
        <p className="truncate px-2 text-xs uppercase tracking-wider text-white/40">
          {organizationName}
        </p>

        <nav className="mt-5 space-y-1">
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
      </div>
    </aside>
  );
}