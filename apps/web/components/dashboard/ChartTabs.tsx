const tabs = ["Live", "Week", "Month"];

export default function ChartTabs() {
  return (
    <div className="flex gap-2">
      {tabs.map((tab, index) => (
        <button
          key={tab}
          className={
            index === 0
              ? "rounded-md bg-blue-500 px-2 py-1 text-xs text-white"
              : "rounded-md px-2 py-1 text-xs text-slate-400 hover:text-white"
          }
        >
          {tab}
        </button>
      ))}
    </div>
  );
}