import { SUPPORTED_BIDDING_ZONES } from "@/lib/market-price/constants";

type TimeRangeOption = {
  key: "today" | "week" | "month" | "year";
  label: string;
  enabled: boolean;
};

/**
 * Only "today" is wired to real data this milestone. The others are
 * rendered disabled rather than omitted so activating one later is
 * flipping `enabled: true` and giving it a real `getMarketPageData`
 * range, not redesigning this toolbar.
 */
const TIME_RANGE_OPTIONS: readonly TimeRangeOption[] = [
  { key: "today", label: "Today", enabled: true },
  { key: "week", label: "Week", enabled: false },
  { key: "month", label: "Month", enabled: false },
  { key: "year", label: "Year", enabled: false },
];

const RESOLUTION_OPTIONS = [{ value: "15", label: "15 minutes" }] as const;

type MarketToolbarProps = {
  selectedDate: string;
  prevDateParam: string;
  nextDateParam: string;
  isToday: boolean;
};

export function MarketToolbar({
  selectedDate,
  prevDateParam,
  nextDateParam,
  isToday,
}: MarketToolbarProps) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`/market?date=${prevDateParam}`}
          aria-label="Previous day"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-400 transition hover:border-white/20 hover:text-white"
        >
          ‹
        </a>

        <form action="/market" method="get" className="flex items-center gap-1.5">
          <input
            type="date"
            name="date"
            defaultValue={selectedDate}
            className="h-8 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-white [color-scheme:dark]"
          />
          <button
            type="submit"
            className="h-8 rounded-lg border border-white/10 px-2.5 text-xs font-medium text-slate-300 transition hover:border-white/20 hover:text-white"
          >
            Go
          </button>
        </form>

        <a
          href={`/market?date=${nextDateParam}`}
          aria-label="Next day"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-400 transition hover:border-white/20 hover:text-white"
        >
          ›
        </a>

        {!isToday && (
          <a
            href="/market"
            className="h-8 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-2.5 text-xs font-medium leading-8 text-cyan-300 transition hover:bg-cyan-500/15"
          >
            Jump to today
          </a>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-0.5">
          {TIME_RANGE_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              disabled={!option.enabled}
              title={option.enabled ? undefined : "Coming soon"}
              className={
                option.enabled
                  ? "rounded-md bg-white/10 px-2.5 py-1 text-xs font-medium text-white"
                  : "cursor-not-allowed rounded-md px-2.5 py-1 text-xs font-medium text-slate-600"
              }
            >
              {option.label}
              {!option.enabled && (
                <span className="ml-1 text-[9px] uppercase tracking-wide text-slate-700">
                  soon
                </span>
              )}
            </button>
          ))}
        </div>

        <select
          disabled
          defaultValue={SUPPORTED_BIDDING_ZONES[0]?.code}
          aria-label="Country"
          className="h-8 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-slate-300 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {SUPPORTED_BIDDING_ZONES.map((zone) => (
            <option key={zone.code} value={zone.code}>
              {zone.label}
            </option>
          ))}
        </select>

        <select
          disabled
          defaultValue={RESOLUTION_OPTIONS[0].value}
          aria-label="Time resolution"
          className="h-8 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-slate-300 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {RESOLUTION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
