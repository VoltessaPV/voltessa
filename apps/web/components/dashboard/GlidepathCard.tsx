import { TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { Suspense } from "react";

import type { DashboardForecastChartData } from "@/app/[locale]/(platform)/dashboard/dashboard-data";
import { ChartSkeleton } from "@/components/charts/ChartSkeleton";
import { DynamicForecastChart } from "@/components/dashboard/ForecastChart.dynamic";

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
 * Forecast Card Visualization milestone: the chart now shows today's whole
 * Sofia-local calendar day as one continuous timeline — the actual,
 * reconstructed Available PV for every elapsed interval (green, same color
 * `LiveEnergyChart`'s PV Output line uses), the forecast for every
 * remaining interval (grey), and a NOW divider between them
 * (`ForecastChart.tsx`, through the same `ChartFrame` shell every other
 * Dashboard/Market chart renders through). Peak/Expected-energy describe
 * only the *remaining* portion of today — see `dashboard-data.ts`'s
 * `buildForecastChartData` doc comment for why a rolling "next N hours"
 * window (this card's previous behavior) was the actual cause of an
 * apparent forecast discrepancy a user reported, not a calculation defect.
 *
 * Exported symbol name unchanged from the earlier placeholder (see git
 * history) to avoid touching every import site for a label-only rename —
 * still labeled "Forecast" (`tTerm("forecast")`), matching the Dashboard's
 * terminology pass.
 */
type GlidepathCardProps = {
  forecastChart: DashboardForecastChartData | null;
};

export function GlidepathCard({ forecastChart }: GlidepathCardProps) {
  const t = useTranslations("dashboard.forecast");
  const tTerm = useTranslations("terminology");

  const hasForecast = forecastChart !== null;

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
              <dd className="text-sm font-medium tabular-nums text-white">
                {forecastChart.peakForecastKw !== null ? forecastChart.peakForecastKw.toFixed(1) : "0.0"} kW
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-slate-500">{t("expectedEnergy")}</dt>
              <dd className="text-sm font-medium tabular-nums text-white">
                {forecastChart.expectedEnergyKwh !== null ? forecastChart.expectedEnergyKwh.toFixed(1) : "0.0"} kWh
              </dd>
            </div>
          </dl>

          <div className="mt-3 h-[170px] border-t border-white/10 pt-2">
            <Suspense fallback={<ChartSkeleton />}>
              <DynamicForecastChart data={forecastChart.chartSeries} />
            </Suspense>
          </div>

          <p className="mt-1 text-[10px] text-slate-600">
            {t("caption", { resolution: forecastChart.intervalMinutes, horizon: forecastChart.horizonHours })}
          </p>
        </>
      )}
    </div>
  );
}
