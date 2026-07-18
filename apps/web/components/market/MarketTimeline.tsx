import type {
  TimelineEvent,
  TimelineSummary,
} from "@/app/(platform)/market/market-data";

type MarketTimelineProps = {
  events: TimelineEvent[];
  summary: TimelineSummary;
};

/**
 * Past actions, current state, and the next scheduled export action —
 * all derived from real threshold crossings against the already-known
 * day-ahead price curve (day-ahead prices for the whole day are published
 * in advance, so "next" is a real, known fact, not a forecast). Once a
 * real automation/decision engine exists, its actual executed actions can
 * replace these threshold-crossing events without changing this
 * component's props shape.
 */
export function MarketTimeline({ events, summary }: MarketTimelineProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)]">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
        Market Timeline
      </p>

      <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <p className="text-[11px] text-slate-500">Current state</p>
        <p className="mt-0.5 text-sm font-medium text-white">
          {summary.currentStateLabel}
          {summary.currentStateSinceLabel && (
            <span className="ml-1.5 font-normal text-slate-500">
              {summary.currentStateSinceLabel}
            </span>
          )}
        </p>

        {summary.nextActionLabel && (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-cyan-300">
            <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-cyan-400">
              Next
            </span>
            {summary.nextActionLabel}
          </p>
        )}
      </div>

      {events.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">
          No export-state changes for this day.
        </p>
      ) : (
        <ol className="mt-3 space-y-3">
          {events.map((event, index) => {
            const enabled = event.type === "export_enabled";

            return (
              <li
                key={`${event.timeLabel}-${index}`}
                className={`flex gap-3 ${event.isPast && !event.isNext ? "opacity-50" : ""}`}
              >
                <div className="flex flex-col items-center">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${enabled ? "bg-emerald-400" : "bg-slate-500"} ${event.isNext ? "ring-2 ring-cyan-400/40" : ""}`}
                  />
                  {index < events.length - 1 && (
                    <span className="mt-1 w-px flex-1 bg-white/10" />
                  )}
                </div>

                <div className="pb-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium tabular-nums text-white">
                      {event.timeLabel}
                    </span>
                    <span
                      className={`text-xs font-medium ${enabled ? "text-emerald-400" : "text-slate-400"}`}
                    >
                      {enabled ? "Export enabled" : "Export disabled"}
                    </span>
                    {event.isNext && (
                      <span className="rounded bg-cyan-500/10 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-cyan-400">
                        Next
                      </span>
                    )}
                  </div>

                  <p className="mt-0.5 text-xs text-slate-500">
                    {event.reason}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
