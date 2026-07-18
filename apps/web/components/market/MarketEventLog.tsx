import type { MarketEventLogEntry } from "@/app/(platform)/market/market-data";

type MarketEventLogProps = {
  entries: MarketEventLogEntry[];
};

const EVENT_DOT_CLASS: Record<MarketEventLogEntry["type"], string> = {
  export_enabled: "bg-emerald-400",
  export_stopped: "bg-slate-500",
  threshold_crossed: "bg-amber-400",
  automation_executed: "bg-cyan-400",
  huawei_command_sent: "bg-blue-400",
  trader_schedule_generated: "bg-violet-400",
  manual_override: "bg-red-400",
};

/**
 * A real system event log — not derived from prices. Empty until a real
 * producer exists (automation engine, Huawei execution, trader
 * scheduling, manual overrides); see MarketEventLogEntry's doc comment
 * for the exact event types this is already typed to accept.
 */
export function MarketEventLog({ entries }: MarketEventLogProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)]">
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
        Event Log
      </p>

      {entries.length === 0 ? (
        <div className="mt-6 flex flex-col items-center justify-center py-6 text-center">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-slate-600">
            <svg
              viewBox="0 0 20 20"
              fill="none"
              className="h-4 w-4"
              aria-hidden
            >
              <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.4" />
              <path d="M10 6.5V10l2.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </span>
          <p className="mt-3 text-sm text-slate-400">No events yet</p>
          <p className="mt-1 max-w-[220px] text-xs text-slate-600">
            Automation decisions, Huawei commands, and trader schedules will
            appear here once connected.
          </p>
        </div>
      ) : (
        <ol className="mt-3 space-y-3">
          {entries.map((entry, index) => (
            <li key={`${entry.timestamp.toISOString()}-${index}`} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${EVENT_DOT_CLASS[entry.type]}`}
                />
                {index < entries.length - 1 && (
                  <span className="mt-1 w-px flex-1 bg-white/10" />
                )}
              </div>

              <div className="pb-1">
                <p className="text-sm font-medium text-white">
                  {entry.label}
                </p>
                {entry.detail && (
                  <p className="mt-0.5 text-xs text-slate-500">
                    {entry.detail}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
