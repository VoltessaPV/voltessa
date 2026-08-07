"use client";

import { Line } from "recharts";

import type { MarketPricePoint } from "@/app/[locale]/(platform)/market/market-data";
import { ChartFrame, type ChartFrameYAxis } from "@/components/charts/ChartFrame";
import { CHART_TOOLTIP_CLASSNAME, computeFixedChartTicks, formatSofiaDate, formatSofiaTime } from "@/components/charts/chart-style";
import type { SocPoint } from "@/lib/market-price/chart-aggregation";

/**
 * Battery Digital Twin UI milestone. SOC is state, not an energy flow - this
 * chart only ever renders `simulatedSocChart` exactly as
 * `aggregateSocSeriesForChart` produced it (last-value-per-bucket, never
 * summed/averaged - see that function's doc comment). No battery scenario
 * for "Current" exists, so this chart only ever appears once, for
 * "Simulated". Reuses `ChartFrame` directly - the same shell
 * `MarketPriceChart` renders through - rather than a second chart engine.
 *
 * Battery Price KPIs milestone: `priceSeries` is an optional market-price
 * overlay (dual Y axes, exactly `MarketPriceChart`'s own left-price/
 * right-other-axis technique, mirrored here as left-SOC/right-price) to
 * visually explain why the optimizer charged/discharged - omitted entirely
 * for periods over 7 days (the caller passes `undefined` in that case; see
 * `DigitalTwinForm.tsx`), where a long price line would be noise. Always
 * the exact same aggregated series `simulatedChart.price` already computes
 * for the Simulated MarketPriceChart panel - never a second price
 * calculation.
 */
type BatterySocChartProps = {
  series: SocPoint[];
  batteryCapacityKwh: number;
  /** Same meaning as `MarketPriceChart`'s own prop - "time" for a single native day, "day" once the chart is hourly/daily-bucketed. */
  xAxisUnit?: "time" | "day";
  priceSeries?: MarketPricePoint[];
  /** Same shared-axis domain/ticks the page's two MarketPriceChart panels already use (`computePriceAxisDomain`) - visual consistency across every chart on the page. */
  priceAxis?: { domain: [number, number]; ticks: number[] };
};

type SocPriceDatum = {
  time: number;
  socKwh: number | null;
  price: number | null;
};

/** ENTSO-E's native day-ahead cadence - the bucket width a "native" (single-day) chart's price points each hold for. */
const NATIVE_PRICE_BUCKET_MS = 15 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * SOC/Market Price chart bug fix. `series` is native (post-PR #57, every 5
 * minutes); `priceSeries` is either ENTSO-E's own native 15-minute cadence
 * (`xAxisUnit === "time"`, a single-day chart) or already hourly-bucketed
 * (`xAxisUnit === "day"`, the only other case this component ever receives
 * a price series for - `DigitalTwinForm.tsx` never passes one for a
 * `"daily"`-resolution, >7-day chart). Joining these two grids by exact
 * timestamp equality (the original approach) silently dropped 2 of every 3
 * SOC points' price on a single-day chart, since only every third 5-minute
 * SOC sample lands on a 15-minute price timestamp.
 *
 * A market price is a step function - it holds for its whole bucket, not
 * just its own leading instant - so the correct join for a SOC point is
 * "the latest known price bucket at or before this SOC point's own
 * timestamp," not an exact match. This is not an approximation: it is
 * exactly what the price was at that moment. `priceSeries` is assumed
 * sorted ascending (true for every caller here), so a single forward
 * sweep alongside `series`'s own ascending order is enough - no need for a
 * second, less efficient lookup structure.
 */
function buildSocPriceData(series: SocPoint[], priceSeries: MarketPricePoint[] | undefined, bucketMs: number): SocPriceDatum[] {
  const sortedPrices = priceSeries ? [...priceSeries].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()) : [];
  let priceIndex = 0;

  return series.map((point) => {
    const time = point.intervalStart.getTime();

    while (priceIndex + 1 < sortedPrices.length && sortedPrices[priceIndex + 1]!.timestamp.getTime() <= time) {
      priceIndex += 1;
    }

    const current = sortedPrices[priceIndex];
    const bucketStartMs = current?.timestamp.getTime();
    const price =
      current && bucketStartMs !== undefined && bucketStartMs <= time && time < bucketStartMs + bucketMs ? current.price : null;

    return { time, socKwh: point.socKwh, price };
  });
}

function SocPriceTooltip({
  active,
  payload,
  label,
  labelFormatter,
  hasPrice,
}: {
  active?: boolean;
  payload?: Array<{ value: number | null; dataKey: string }>;
  label?: number;
  labelFormatter: (time: number) => string;
  hasPrice: boolean;
}) {
  if (!active || !payload || payload.length === 0 || label === undefined) {
    return null;
  }

  const socKwh = payload.find((entry) => entry.dataKey === "socKwh")?.value ?? null;
  const price = payload.find((entry) => entry.dataKey === "price")?.value ?? null;

  return (
    <div className={CHART_TOOLTIP_CLASSNAME}>
      <p className="font-medium text-slate-300">{labelFormatter(label)}</p>
      {socKwh !== null && (
        <p className="mt-1 flex items-center gap-1.5 text-amber-400">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          {socKwh.toFixed(2)} kWh
        </p>
      )}
      {hasPrice && price !== null && (
        <p className="mt-1 flex items-center gap-1.5 text-blue-400">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
          {price} EUR/MWh
        </p>
      )}
      {socKwh === null && !(hasPrice && price !== null) && <p className="mt-1 text-slate-500">No data</p>}
    </div>
  );
}

export function BatterySocChart({ series, batteryCapacityKwh, xAxisUnit = "time", priceSeries, priceAxis }: BatterySocChartProps) {
  const hasPrice = Boolean(priceSeries && priceAxis);
  const bucketMs = xAxisUnit === "time" ? NATIVE_PRICE_BUCKET_MS : HOUR_MS;
  const data: SocPriceDatum[] = buildSocPriceData(series, priceSeries, bucketMs);

  const domainStart = data[0]?.time;
  const xTicks = xAxisUnit === "time" && domainStart !== undefined ? computeFixedChartTicks(domainStart) : undefined;
  const xAxisTickFormatter = xAxisUnit === "time" ? formatSofiaTime : formatSofiaDate;

  const yAxes: ChartFrameYAxis[] = [
    {
      yAxisId: "soc",
      unitLabel: "kWh",
      domain: [0, Math.max(batteryCapacityKwh, 1)],
      allowDataOverflow: true,
    },
    ...(hasPrice
      ? [
          {
            yAxisId: "price",
            orientation: "right" as const,
            unitLabel: "EUR/MWh",
            domain: priceAxis!.domain,
            allowDataOverflow: true,
            ticks: priceAxis!.ticks,
          },
        ]
      : []),
  ];

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-1 text-xs">
        <span className="flex items-center gap-1.5 text-slate-300">
          <span className="h-0.5 w-3 rounded-full bg-amber-400" />
          Battery SOC
        </span>

        {hasPrice && (
          <>
            <span className="h-3 w-px bg-white/10" />
            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="h-0.5 w-3 rounded-full bg-blue-400" />
              Market Price
            </span>
          </>
        )}
      </div>

      <div className="mt-2 min-h-0 flex-1">
        <ChartFrame
          data={data}
          yAxes={yAxes}
          tooltipContent={<SocPriceTooltip labelFormatter={xAxisTickFormatter} hasPrice={hasPrice} />}
          xTicks={xTicks}
          tickFormatter={xAxisTickFormatter}
        >
          <Line
            yAxisId="soc"
            type="monotone"
            dataKey="socKwh"
            stroke="#fbbf24"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3.5, fill: "#fcd34d" }}
            connectNulls={false}
            isAnimationActive
            animationDuration={700}
          />

          {hasPrice && (
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="price"
              stroke="#60a5fa"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3.5, fill: "#93c5fd" }}
              connectNulls={false}
              isAnimationActive
              animationDuration={700}
            />
          )}
        </ChartFrame>
      </div>
    </div>
  );
}
