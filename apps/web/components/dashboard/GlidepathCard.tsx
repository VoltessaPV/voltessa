import type { GlidepathData } from "@/app/(platform)/dashboard/dashboard-data";

type GlidepathCardProps = {
  glidepath: GlidepathData;
};

/**
 * Production glidepath — current production is real (the same live meter
 * reading the energy-flow diagram uses); no production-forecasting model
 * exists in this codebase (confirmed by search, not assumed), so forecast
 * production, forecast completion, and expected end-of-day are shown as
 * honestly unavailable rather than fabricated. No financial information
 * here, per this milestone's explicit requirement — see the Market widget
 * for revenue/price.
 */
export function GlidepathCard({ glidepath }: GlidepathCardProps) {
  const { currentProduction } = glidepath;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)]">
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Glidepath</p>

      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500">Current production</span>
          <span className="tabular-nums text-white">
            {currentProduction.available ? `${currentProduction.kw.toFixed(1)} kW` : "—"}
          </span>
        </div>

        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500">Forecast production</span>
          <span className="text-slate-600">
            {glidepath.forecastProductionKw !== null
              ? `${glidepath.forecastProductionKw.toFixed(1)} kW`
              : "Not available"}
          </span>
        </div>

        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500">Forecast completion</span>
          <span className="text-slate-600">
            {glidepath.forecastCompletionPercent !== null
              ? `${glidepath.forecastCompletionPercent}%`
              : "Not available"}
          </span>
        </div>

        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500">Expected end-of-day</span>
          <span className="text-slate-600">
            {glidepath.expectedEndOfDayKwh !== null
              ? `${glidepath.expectedEndOfDayKwh.toFixed(1)} kWh`
              : "Not available"}
          </span>
        </div>
      </div>

      <p className="mt-3 border-t border-white/10 pt-2 text-[11px] leading-snug text-slate-600">
        Production forecasting is not yet implemented.
      </p>
    </div>
  );
}
