/**
 * Deliberately shows no revenue figure. Market prices on this page are
 * real (ENTSO-E); production telemetry (FusionSolar) is not connected
 * yet, so there is no real export volume to multiply those prices by.
 * An earlier version of this card multiplied real prices by an
 * illustrative generation curve to show a Euro total — that looked like
 * real money and wasn't, so it was removed rather than caveated.
 */
export function MarketRevenueCard() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)]">
      <p className="w-full text-left text-[11px] font-medium uppercase tracking-wider text-slate-500">
        Today&apos;s Revenue
      </p>

      <span className="mt-5 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-slate-600">
        <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden>
          <path
            d="M4 10h12M4 6h8M4 14h5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </span>

      <p className="mt-3 text-sm font-medium text-slate-300">
        Revenue unavailable
      </p>
      <p className="mt-1 text-xs text-slate-600">
        Waiting for production telemetry
      </p>
      <p className="mt-4 text-[10px] leading-snug text-slate-700">
        Market prices are real. Production data is not yet connected.
      </p>
    </div>
  );
}
