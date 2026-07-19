type MarketInfoProps = {
  country: string;
  source: string;
  lastUpdateLabel: string | null;
};

/**
 * Compact market metadata card (Market Dashboard UX Polish milestone) —
 * Country/Source/Last update used to live as extra rows on the Threshold
 * summary card; moved here so every top card can share the same height
 * (see the Threshold card in `page.tsx`) and this metadata gets its own
 * clearly-labelled home in the bottom row instead.
 */
export function MarketInfo({ country, source, lastUpdateLabel }: MarketInfoProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)]">
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
        Market Info
      </p>

      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500">Country</span>
          <span className="text-slate-300">{country}</span>
        </div>

        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500">Source</span>
          <span className="text-slate-300">{source}</span>
        </div>

        {lastUpdateLabel && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">Last update</span>
            <span className="text-slate-300">{lastUpdateLabel}</span>
          </div>
        )}
      </div>
    </div>
  );
}
