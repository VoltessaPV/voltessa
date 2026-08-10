import { TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";

import type { ForecastSummary } from "@/app/[locale]/(platform)/dashboard/dashboard-data";

/**
 * Dashboard bottom-row card — kept in its original position (Inverters,
 * Weather, Forecast, Event Log), not folded into Live Energy. Live Energy
 * itself already overlays the same forecast data as a grey PV line
 * (`LiveEnergyChart.tsx`'s `forecastPvKw` series) — this card is the
 * dedicated forecast *summary*, not a second chart: Daily/Remaining today/
 * Weekly/Monthly/Peak/Confidence, straight from `ForecastSummary`
 * (`dashboard-data.ts`) with no calculation happening here.
 */
type ForecastCardProps = {
  summary: ForecastSummary | null;
};

const CONFIDENCE_DOT_CLASS: Record<"HIGH" | "MEDIUM" | "LOW", string> = {
  HIGH: "bg-emerald-400",
  MEDIUM: "bg-amber-400",
  LOW: "bg-slate-400",
};

function statValueLabel(kwh: number | null): string {
  return kwh !== null ? `${kwh.toFixed(1)} kWh` : "—";
}

/** Sofia-local `HH:MM`, matching this page's other Europe/Sofia time labels — see `page.tsx`'s `sofiaDateTimeLabel`. */
function sofiaTimeLabel(date: Date): string {
  return date.toLocaleTimeString("en-GB", { timeZone: "Europe/Sofia", hour: "2-digit", minute: "2-digit" });
}

export function ForecastCard({ summary }: ForecastCardProps) {
  const t = useTranslations("dashboard.forecastSummary");
  const tTerm = useTranslations("terminology");

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)]">
      <div>
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-500">
          <TrendingUp className="h-3.5 w-3.5" />
          {tTerm("forecast")}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-600">{t("subtitle")}</p>
      </div>

      {!summary ? (
        <p className="mt-3 text-sm text-slate-500">{t("unavailable")}</p>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <dt className="text-[11px] text-slate-500">{t("dailyForecast")}</dt>
            <dd className="text-sm font-medium tabular-nums text-white">{statValueLabel(summary.dailyForecastKwh)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-slate-500">{t("remainingToday")}</dt>
            <dd className="text-sm font-medium tabular-nums text-white">{statValueLabel(summary.remainingTodayKwh)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-slate-500">{t("weeklyForecast")}</dt>
            <dd className="text-sm font-medium tabular-nums text-white">{statValueLabel(summary.weeklyForecastKwh)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-slate-500">{t("monthlyForecast")}</dt>
            <dd className="text-sm font-medium tabular-nums text-white">{statValueLabel(summary.monthlyForecastKwh)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-slate-500">{t("peak")}</dt>
            <dd className="text-sm font-medium tabular-nums text-white">
              {summary.peakForecastKw !== null ? `${summary.peakForecastKw.toFixed(1)} kW` : "—"}
            </dd>
          </div>
          {summary.confidence && (
            <div>
              <dt className="text-[11px] text-slate-500">{t("confidence.label")}</dt>
              <dd className="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-white">
                <span className={`h-1.5 w-1.5 rounded-full ${CONFIDENCE_DOT_CLASS[summary.confidence]}`} />
                {t(`confidence.${summary.confidence.toLowerCase() as "high" | "medium" | "low"}`)}
              </dd>
            </div>
          )}
        </dl>
      )}

      {summary && (
        <p className="mt-3 text-[10px] text-slate-600">
          {t("updated", { time: sofiaTimeLabel(summary.issuedAt) })}
        </p>
      )}
    </div>
  );
}
