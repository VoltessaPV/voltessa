"use client";

import { useTranslations } from "next-intl";
import { Line, ReferenceArea, ReferenceLine } from "recharts";

import type { ForecastChartPoint } from "@/app/[locale]/(platform)/dashboard/dashboard-data";
import { ChartFrame, type ChartFrameYAxis } from "@/components/charts/ChartFrame";
import { CHART_TOOLTIP_CLASSNAME, computeFixedChartTicks, formatSofiaTime } from "@/components/charts/chart-style";
import { NowLabel } from "@/components/charts/NowMarker";

type ForecastChartProps = {
  data: ForecastChartPoint[];
};

const Y_AXES: ChartFrameYAxis[] = [{ yAxisId: "power", unitLabel: "kW" }];

/**
 * Forecast Card Visualization milestone. Same chart shell (`ChartFrame`),
 * axis/grid/tooltip chrome, and NOW-marker convention `LiveEnergyChart`
 * already established for the Dashboard — this is not a second charting
 * pattern, only a second data series through the identical machinery.
 * `actualKw` (reconstructed Available PV, Zero-Export-independent — never
 * historical export) renders as the same green used for PV Output
 * elsewhere on this Dashboard; `forecastKw` renders grey, per this
 * platform's convention that grey means "forecast," not a measured value.
 */
function ForecastTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number | null; dataKey: string; color: string }>;
  label?: number;
}) {
  const t = useTranslations("dashboard.forecast");

  if (!active || !payload || payload.length === 0 || label === undefined) {
    return null;
  }

  const actual = payload.find((p) => p.dataKey === "actualKw");
  const forecast = payload.find((p) => p.dataKey === "forecastKw");
  const hasActual = actual && actual.value !== null && actual.value !== undefined;
  const hasForecast = forecast && forecast.value !== null && forecast.value !== undefined;

  return (
    <div className={CHART_TOOLTIP_CLASSNAME}>
      <p className="font-medium text-slate-300">{formatSofiaTime(label)}</p>

      {hasActual && (
        <p className="mt-1 flex items-center gap-1.5" style={{ color: actual!.color }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: actual!.color }} />
          {actual!.value!.toFixed(1)} kW {t("legend.actual")} · {(actual!.value! * 0.25).toFixed(1)} kWh
        </p>
      )}
      {hasForecast && (
        <p className="mt-1 flex items-center gap-1.5" style={{ color: forecast!.color }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: forecast!.color }} />
          {forecast!.value!.toFixed(1)} kW {t("legend.forecast")} · {(forecast!.value! * 0.25).toFixed(1)} kWh
        </p>
      )}
      {!hasActual && !hasForecast && <p className="mt-1 text-slate-500">{t("noData")}</p>}
    </div>
  );
}

export function ForecastChart({ data }: ForecastChartProps) {
  const t = useTranslations("dashboard.forecast");

  const domainStart = data[0]?.time;
  const now = Date.now();
  const nowInRange = domainStart !== undefined && now >= domainStart && now <= (data[data.length - 1]?.time ?? domainStart);
  const xTicks = domainStart !== undefined ? computeFixedChartTicks(domainStart) : undefined;
  const dayEnd = data.length > 0 ? data[data.length - 1]!.time + 15 * 60 * 1000 : undefined;

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center gap-4 px-1 text-[11px]">
        <span className="flex items-center gap-1.5 text-slate-300">
          <span className="h-0.5 w-3 rounded-full bg-emerald-400" />
          {t("legend.actual")}
        </span>
        <span className="flex items-center gap-1.5 text-slate-300">
          <span className="h-0.5 w-3 rounded-full bg-slate-400" />
          {t("legend.forecast")}
        </span>
      </div>

      <div className="mt-1 min-h-0 flex-1">
        <ChartFrame data={data} yAxes={Y_AXES} tooltipContent={<ForecastTooltip />} xTicks={xTicks}>
          {nowInRange && dayEnd !== undefined && (
            <ReferenceArea yAxisId="power" x1={now} x2={dayEnd} fill="#ffffff" fillOpacity={0.02} />
          )}

          <Line
            yAxisId="power"
            type="monotone"
            dataKey="actualKw"
            stroke="#34d399"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3.5 }}
            connectNulls={false}
            isAnimationActive
            animationDuration={500}
          />
          <Line
            yAxisId="power"
            type="monotone"
            dataKey="forecastKw"
            stroke="#94a3b8"
            strokeWidth={2}
            dot={{ r: 1.5, fill: "#94a3b8", strokeWidth: 0 }}
            activeDot={{ r: 3.5 }}
            connectNulls={false}
            isAnimationActive
            animationDuration={500}
          />

          {nowInRange && (
            <ReferenceLine x={now} yAxisId="power" stroke="#64748b" strokeOpacity={0.6} strokeWidth={1.5} label={<NowLabel />} />
          )}
        </ChartFrame>
      </div>
    </div>
  );
}
