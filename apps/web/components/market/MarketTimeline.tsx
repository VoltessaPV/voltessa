import type { TimelineEvent } from "@/app/(platform)/market/mock-data";

type MarketTimelineProps = {
  events: TimelineEvent[];
};

export function MarketTimeline({ events }: MarketTimelineProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)]">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
        Market Timeline
      </p>

      <ol className="mt-4 space-y-4">
        {events.map((event, index) => {
          const enabled = event.type === "export_enabled";

          return (
            <li key={`${event.timeLabel}-${index}`} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${enabled ? "bg-emerald-400" : "bg-slate-500"}`}
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
                </div>

                <p className="mt-0.5 text-xs text-slate-500">
                  {event.reason}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
