import { useTranslations } from "next-intl";

import type { ForecastSummary } from "@/app/[locale]/(platform)/dashboard/dashboard-data";

/**
 * Live Energy Forecast Integration milestone. The Live Energy card's own
 * compact forecast summary strip — replaces the old standalone
 * `GlidepathCard` (deleted this milestone) as the Dashboard's forecast
 * surface, per this milestone's explicit "don't leave two competing
 * forecast visualizations" requirement. Rendered directly below
 * `LiveEnergyChart` inside the same card, never as its own bottom-row card.
 *
 * All five figures come straight from `ForecastSummary`
 * (`dashboard-data.ts`) — no calculation happens in this component. Confidence
 * is a plain label (`lib/forecast/forecast-tiers.ts`), never a fabricated
 * precise percentage, per this milestone's explicit accuracy-honesty
 * requirement.
 */
type ForecastSummaryPanelProps = {
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

export function ForecastSummaryPanel({ summary }: ForecastSummaryPanelProps) {
  const t = useTranslations("dashboard.forecastSummary");
  const tTerm = useTranslations("terminology");

  if (!summary) {
    return <p className="mt-2 text-[11px] text-slate-600">{t("unavailable")}</p>;
  }

  const stats: Array<{ key: string; label: string; value: string }> = [
    { key: "daily", label: t("dailyForecast"), value: statValueLabel(summary.dailyForecastKwh) },
    { key: "remaining", label: t("remainingToday"), value: statValueLabel(summary.remainingTodayKwh) },
    { key: "weekly", label: t("weeklyForecast"), value: statValueLabel(summary.weeklyForecastKwh) },
    { key: "monthly", label: t("monthlyForecast"), value: statValueLabel(summary.monthlyForecastKwh) },
    {
      key: "peak",
      label: t("peak"),
      value: summary.peakForecastKw !== null ? `${summary.peakForecastKw.toFixed(1)} kW` : "—",
    },
  ];

  return (
    <div className="mt-2.5 border-t border-white/10 pt-2.5">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{tTerm("forecast")}</p>
        {summary.confidence && (
          <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className={`h-1.5 w-1.5 rounded-full ${CONFIDENCE_DOT_CLASS[summary.confidence]}`} />
            {t("confidence.label")}: {t(`confidence.${summary.confidence.toLowerCase() as "high" | "medium" | "low"}`)}
          </span>
        )}
      </div>

      <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-5">
        {stats.map((stat) => (
          <div key={stat.key}>
            <dt className="text-[10px] text-slate-500">{stat.label}</dt>
            <dd className="text-xs font-medium tabular-nums text-white">{stat.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
