import { TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";

import type { PvForecastResult } from "@/lib/forecast/types";

/**
 * PV Generation Forecast milestone. Real production forecast — physical
 * solar-position + clear-sky model, Open-Meteo weather, this plant's own
 * historical calibration, similarity-selected analog days, and a recent
 * glide-path correction (`lib/forecast/pv-forecast-engine.ts`), never a
 * mockup. Independent of historical Zero Export, battery operation, and
 * market price by construction — the engine never imports
 * `battery-dispatch.ts` or any price/threshold module, and its historical
 * inputs always come from `reconstructAvailablePv` (physically available
 * PV), never curtailed export.
 *
 * Exported symbol name unchanged from the earlier placeholder (see git
 * history) to avoid touching every import site for a label-only rename —
 * still labeled "Forecast" (`tTerm("forecast")`), matching the Dashboard's
 * terminology pass.
 */
type GlidepathCardProps = {
  forecast: PvForecastResult | null;
};

const SPARKLINE_WIDTH = 280;
const SPARKLINE_HEIGHT = 48;
/** How far ahead this narrow card visualizes — the engine itself forecasts a full 24h horizon; a trading/scheduling caller reads `forecast.intervals` directly for the rest. */
const VISIBLE_HOURS = 8;
const INTERVALS_PER_HOUR = 4;

function buildSparklinePath(values: number[], maxValue: number): string {
  if (values.length === 0 || maxValue <= 0) {
    return "";
  }

  const stepX = SPARKLINE_WIDTH / Math.max(1, values.length - 1);
  return values
    .map((value, index) => {
      const x = index * stepX;
      const y = SPARKLINE_HEIGHT - (value / maxValue) * SPARKLINE_HEIGHT;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function GlidepathCard({ forecast }: GlidepathCardProps) {
  const t = useTranslations("dashboard.forecast");
  const tTerm = useTranslations("terminology");

  const visibleIntervals = forecast?.intervals.slice(0, VISIBLE_HOURS * INTERVALS_PER_HOUR) ?? [];
  const hasForecast = visibleIntervals.length > 0;

  const peakKw = hasForecast ? Math.max(...visibleIntervals.map((interval) => interval.forecastKw)) : 0;
  const totalKwh = hasForecast ? visibleIntervals.reduce((sum, interval) => sum + interval.forecastKwh, 0) : 0;
  const sparklinePath = hasForecast
    ? buildSparklinePath(
        visibleIntervals.map((interval) => interval.forecastKw),
        Math.max(peakKw, 1),
      )
    : "";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)]">
      <div>
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-500">
          <TrendingUp className="h-3.5 w-3.5" />
          {tTerm("forecast")}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-600">{t("subtitle")}</p>
      </div>

      {!hasForecast ? (
        <p className="mt-3 text-sm text-slate-500">{t("unavailable")}</p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
            <div>
              <dt className="text-[11px] text-slate-500">{t("peak")}</dt>
              <dd className="text-sm font-medium tabular-nums text-white">{peakKw.toFixed(1)} kW</dd>
            </div>
            <div>
              <dt className="text-[11px] text-slate-500">{t("expectedEnergy")}</dt>
              <dd className="text-sm font-medium tabular-nums text-white">{totalKwh.toFixed(1)} kWh</dd>
            </div>
          </dl>

          <div className="mt-3 border-t border-white/10 pt-3">
            <svg
              viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
              preserveAspectRatio="none"
              className="h-12 w-full"
              aria-hidden="true"
            >
              <path d={sparklinePath} fill="none" stroke="#94a3b8" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
            </svg>
            <p className="mt-1 text-[10px] text-slate-600">{t("nextHours", { hours: VISIBLE_HOURS })}</p>
          </div>
        </>
      )}
    </div>
  );
}
