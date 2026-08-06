import type { MarketPricePoint } from "@/app/[locale]/(platform)/market/market-data";
import { localDayBoundsUtc } from "@/lib/market-price/timezone";
import type { SettlementEnergyPoint } from "@/lib/telemetry/energy-metrics";

/**
 * Digital Twin Milestone 6 (Adaptive Visualization). Generalizes the exact
 * bucketing/weighted-average-price technique Market's page.tsx already uses
 * for its Week/Month/Year charts (`bucketSettlementForChart`/
 * `buildAspChartSeries`, day/month granularity only, private to that page)
 * to also support hourly buckets, so Digital Twin's charts can reuse one
 * shared helper instead of a second copy of the same pattern. Purely a
 * presentation-layer aggregation over already-computed settlement/price
 * series - never re-runs a simulation or the Revenue Engine.
 */
export type ChartResolution = "native" | "hourly" | "daily";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The adaptive resolution rule: 1 day or less -> native (whatever grid the
 * caller already has, e.g. the 15-minute settlement grid); 2-7 days ->
 * hourly; more than 7 days -> daily.
 */
export function resolveChartResolution(rangeStart: Date, rangeEnd: Date): ChartResolution {
  const days = (rangeEnd.getTime() - rangeStart.getTime()) / DAY_MS;
  if (days <= 1) return "native";
  if (days <= 7) return "hourly";
  return "daily";
}

/**
 * An hour boundary in Europe/Sofia always coincides with a UTC hour
 * boundary (its offset is always a whole number of hours, DST transitions
 * included), so hourly bucketing needs no timezone-aware math - unlike a
 * calendar day boundary, which does (`localDayBoundsUtc`).
 */
export function bucketStart(instant: Date, resolution: "hourly" | "daily", timeZone: string): number {
  if (resolution === "hourly") {
    return Math.floor(instant.getTime() / HOUR_MS) * HOUR_MS;
  }
  return localDayBoundsUtc(instant, timeZone).start.getTime();
}

function mergeSum(existing: number | null | undefined, value: number | null): number | null {
  return value === null ? (existing ?? null) : (existing ?? 0) + value;
}

/**
 * Sums a settlement-energy series (export + import) into hourly or daily
 * buckets. `resolution: "native"` returns `points` unchanged.
 */
export function aggregateSettlementSeriesForChart(
  points: SettlementEnergyPoint[],
  resolution: ChartResolution,
  timeZone: string,
): SettlementEnergyPoint[] {
  if (resolution === "native") {
    return points;
  }

  const buckets = new Map<number, { exportedKwh: number | null; importedKwh: number | null }>();

  for (const point of points) {
    const bucket = bucketStart(point.intervalStart, resolution, timeZone);
    const existing = buckets.get(bucket) ?? { exportedKwh: null, importedKwh: null };

    buckets.set(bucket, {
      exportedKwh: mergeSum(existing.exportedKwh, point.exportedKwh),
      importedKwh: mergeSum(existing.importedKwh, point.importedKwh),
    });
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, v]) => ({ intervalStart: new Date(t), exportedKwh: v.exportedKwh, importedKwh: v.importedKwh }));
}

/**
 * The chart's Average Selling Price line at the same hourly/daily
 * resolution - `Σ(exportedKwh × price) / Σ(exportedKwh)` per bucket
 * (identical formula to Market's `buildAspChartSeries`), weighted by
 * `settlementSeries`'s own exported energy so Current and Simulated charts
 * each show the price actually realized by THAT column's export profile,
 * not a shared/blended figure. `resolution: "native"` returns `priceSeries`
 * unchanged.
 */
export function aggregatePriceSeriesForChart(
  priceSeries: MarketPricePoint[],
  settlementSeries: Pick<SettlementEnergyPoint, "intervalStart" | "exportedKwh">[],
  resolution: ChartResolution,
  timeZone: string,
): MarketPricePoint[] {
  if (resolution === "native") {
    return priceSeries;
  }

  const exportedByTime = new Map(settlementSeries.map((point) => [point.intervalStart.getTime(), point.exportedKwh]));

  const revenueByBucket = new Map<number, number>();
  const exportedByBucket = new Map<number, number>();
  // The market price exists whether or not the plant exported anything -
  // tracked independently of export so a zero-export bucket still gets a
  // real price (the plain average of its known prices) instead of a gap.
  const priceSumByBucket = new Map<number, number>();
  const priceCountByBucket = new Map<number, number>();

  for (const point of priceSeries) {
    if (point.price === null) {
      continue;
    }

    const bucket = bucketStart(point.timestamp, resolution, timeZone);
    priceSumByBucket.set(bucket, (priceSumByBucket.get(bucket) ?? 0) + point.price);
    priceCountByBucket.set(bucket, (priceCountByBucket.get(bucket) ?? 0) + 1);

    const exportedKwh = exportedByTime.get(point.timestamp.getTime());
    if (exportedKwh === undefined || exportedKwh === null) {
      continue;
    }

    revenueByBucket.set(bucket, (revenueByBucket.get(bucket) ?? 0) + (exportedKwh * point.price) / 1000);
    exportedByBucket.set(bucket, (exportedByBucket.get(bucket) ?? 0) + exportedKwh);
  }

  return [...priceSumByBucket.keys()]
    .sort((a, b) => a - b)
    .map((bucket) => {
      const exportedKwh = exportedByBucket.get(bucket) ?? 0;
      const revenueEur = revenueByBucket.get(bucket) ?? 0;
      // Export-weighted price when the plant exported anything this
      // bucket; otherwise the plain average market price - the price line
      // must never gap just because the plant wasn't exporting.
      const price =
        exportedKwh > 0
          ? Math.round((revenueEur / (exportedKwh / 1000)) * 100) / 100
          : Math.round(((priceSumByBucket.get(bucket) ?? 0) / (priceCountByBucket.get(bucket) ?? 1)) * 100) / 100;

      return { timestamp: new Date(bucket), price, exportEnabled: false };
    });
}

export type SocPoint = {
  intervalStart: Date;
  socKwh: number | null;
};

/**
 * Battery Digital Twin UI milestone. SOC is state, not an energy flow - it
 * must never be summed or averaged across a coarser bucket (that would
 * blend physically meaningless intermediate values). The only valid
 * aggregation is "the last known SOC within the bucket", exactly like
 * reading a fuel gauge at the end of a period rather than adding up the
 * readings you saw along the way. Relies on `points` already being in
 * chronological order (true for every `ReplayOutcome.intervals` this
 * feeds from) so "last write wins" per bucket is correct. `resolution:
 * "native"` returns `points` unchanged, matching every other aggregator in
 * this file.
 */
export function aggregateSocSeriesForChart(
  points: SocPoint[],
  resolution: ChartResolution,
  timeZone: string,
): SocPoint[] {
  if (resolution === "native") {
    return points;
  }

  const lastByBucket = new Map<number, number | null>();

  for (const point of points) {
    const bucket = bucketStart(point.intervalStart, resolution, timeZone);
    lastByBucket.set(bucket, point.socKwh);
  }

  return [...lastByBucket.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, socKwh]) => ({ intervalStart: new Date(t), socKwh }));
}
