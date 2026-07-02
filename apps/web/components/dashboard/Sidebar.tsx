const items = [
  "Overview",
  "Plants",
  "BESS",
  "Market",
  "Automation",
  "Reports",
];

export default function Sidebar() {
  return (
    <aside className="border-r border-slate-800 p-6">
      <div className="mb-8 text-lg font-semibold text-white">
        Voltessa
      </div>

      <nav className="space-y-4">
        {items.map((item, index) => (
          <div
            key={item}
            className={
              index === 0
                ? "text-sm font-medium text-blue-400"
                : "text-sm text-slate-400 transition hover:text-white"
            }
          >
            {item}
          </div>
        ))}
      </nav>
    </aside>
  );
}