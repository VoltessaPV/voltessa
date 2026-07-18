type Trend = "up" | "down" | "flat";

const TREND_GLYPH: Record<Trend, string> = {
  up: "▲",
  down: "▼",
  flat: "▬",
};

const TREND_COLOR_CLASS: Record<Trend, string> = {
  up: "text-emerald-400",
  down: "text-red-400",
  flat: "text-slate-400",
};

export type MarketSummaryCardRow = {
  label: string;
  value: string;
  valueColorClass?: string;
};

export type MarketSummaryCardProps = {
  eyebrow: string;
  value?: string;
  valueUnit?: string;
  caption?: string;
  trend?: { direction: Trend; label: string };
  /** Shown instead of the value block when `value` is omitted (e.g. no live price for a non-today view). */
  unavailableNote?: string;
  rows?: MarketSummaryCardRow[];
  statusDot?: { colorClass: string; label: string };
};

/**
 * Single reusable shell for the Market page's top-row summary cards.
 * Deliberately one flexible component rather than five bespoke ones —
 * Current Price, Next Interval, Lowest/Highest Today, and Market Status
 * all render through this with different props, matching the same visual
 * rhythm (`rounded-2xl border border-white/10 bg-white/[0.03]`) already
 * used across the Dashboard/Settings pages.
 */
export function MarketSummaryCard({
  eyebrow,
  value,
  valueUnit,
  caption,
  trend,
  unavailableNote,
  rows,
  statusDot,
}: MarketSummaryCardProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
          {eyebrow}
        </p>

        {statusDot && (
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <span
              className={`h-1.5 w-1.5 rounded-full ${statusDot.colorClass}`}
            />
            {statusDot.label}
          </div>
        )}
      </div>

      {value !== undefined ? (
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold leading-none tracking-tight text-white tabular-nums">
            {value}
          </span>

          {valueUnit && (
            <span className="text-xs text-slate-500">{valueUnit}</span>
          )}
        </div>
      ) : (
        unavailableNote && (
          <p className="mt-2 text-xs leading-snug text-slate-500">
            {unavailableNote}
          </p>
        )
      )}

      {(caption || trend) && (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          {caption && (
            <span className="text-xs text-slate-500">{caption}</span>
          )}

          {trend && (
            <span
              className={`flex items-center gap-1 text-xs font-medium tabular-nums ${TREND_COLOR_CLASS[trend.direction]}`}
            >
              <span aria-hidden className="text-[9px]">
                {TREND_GLYPH[trend.direction]}
              </span>
              {trend.label}
            </span>
          )}
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="mt-2.5 space-y-1.5 border-t border-white/10 pt-2.5">
          {rows.map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between text-xs"
            >
              <span className="text-slate-500">{row.label}</span>
              <span className={row.valueColorClass ?? "text-slate-300"}>
                {row.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
