const tabs = ["24h", "7d", "30d"];

export default function ChartTabs() {
  return (
    <div className="flex gap-2">
      {tabs.map((tab, index) => (
        <button
          key={tab}
          className={
            index === 0
              ? "rounded-md bg-blue-600 px-2 py-1 text-xs text-white"
              : "rounded-md px-2 py-1 text-xs text-slate-500 hover:text-white"
          }
        >
          {tab}
        </button>
      ))}
    </div>
  );
}