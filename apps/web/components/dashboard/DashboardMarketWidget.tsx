import Link from "next/link";

import type { DashboardMarketWidgetData } from "@/app/(platform)/dashboard/dashboard-data";

type DashboardMarketWidgetProps = {
  market: DashboardMarketWidgetData;
};

/**
 * Compact Market summary for the Dashboard (Final Dashboard UX Refinement
 * milestone) — reuses `market-data.ts`'s already-computed current price
 * and `isExportRecommended` (see `dashboard-data.ts`) rather than a second
 * price/threshold comparison. No new calculation lives here.
 */
export function DashboardMarketWidget({ market }: DashboardMarketWidgetProps) {
  const { currentPrice, exportRecommended, threshold } = market;

  const deltaLabel = currentPrice
    ? `${currentPrice.deltaVsPrevious > 0 ? "+" : currentPrice.deltaVsPrevious < 0 ? "-" : "±"}${Math.abs(currentPrice.deltaVsPrevious).toFixed(2)} EUR/MWh`
    : null;
  const deltaColorClass =
    currentPrice && currentPrice.deltaVsPrevious > 0
      ? "text-emerald-400"
      : currentPrice && currentPrice.deltaVsPrevious < 0
        ? "text-red-400"
        : "text-slate-400";

  return (
    <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)]">
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Market</p>

      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="text-xl font-semibold leading-none tracking-tight text-white tabular-nums">
          {currentPrice ? currentPrice.value.toString() : "—"}
        </span>
        {currentPrice && <span className="text-[11px] text-slate-500">EUR/MWh</span>}
      </div>

      {deltaLabel && (
        <p className={`mt-1 text-xs font-medium tabular-nums ${deltaColorClass}`}>{deltaLabel}</p>
      )}

      <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-2.5 text-xs">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            exportRecommended === null
              ? "bg-slate-500"
              : exportRecommended
                ? "bg-emerald-400"
                : "bg-slate-500"
          }`}
        />
        <span className="text-slate-300">
          {exportRecommended === null
            ? "Recommendation unavailable"
            : exportRecommended
              ? "Export recommended"
              : "Hold export"}
        </span>
      </div>

      <p className="mt-1 text-[11px] text-slate-600">
        Threshold: {threshold.minimumExportPrice} {threshold.currency}/MWh
      </p>

      <Link
        href="/market"
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-cyan-400 transition hover:text-cyan-300"
      >
        View Market
        <span aria-hidden>→</span>
      </Link>
    </div>
  );
}
