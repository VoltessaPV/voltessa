import type { MarketPricePoint } from "@/app/[locale]/(platform)/market/market-data";
import type { SettlementEnergyPoint } from "@/lib/telemetry/energy-metrics";

export type RevenueSummary =
  | {
      available: true;
      revenueEur: number;
      exportedKwh: number;
      averagePriceEurPerMwh: number | null;
    }
  | { available: false };

/**
 * The one per-interval revenue formula: real exported energy (kWh) for a
 * 15-minute settlement interval times the real day-ahead price (EUR/MWh)
 * for that same interval, in EUR. `price` is EUR per MWh, `exportedKwh` is
 * kWh, hence `÷ 1000`. Extracted so `computeExportRevenue` below and the
 * admin Reporting feature's per-row Revenue column
 * (`lib/reporting/build-report.ts`) share a single implementation instead
 * of each writing `(kwh * price) / 1000` inline. Never fabricates: a
 * missing price or missing exported energy yields no revenue for that
 * interval, never a zero.
 */
export function computeIntervalExportRevenueEur(
  exportedKwh: number | null,
  priceEurPerMwh: number | null,
): number | null {
  if (exportedKwh === null || priceEurPerMwh === null) {
    return null;
  }

  return (exportedKwh * priceEurPerMwh) / 1000;
}

/**
 * Real revenue: sum, over every 15-minute settlement interval, of that
 * interval's real exported energy (from the meter's cumulative counter —
 * see energy-metrics.ts) times the real day-ahead price for that *same*
 * interval. Never estimated, never integrated from power — both inputs
 * are already proven-correct real values (Mathematical Correctness
 * milestone); this only multiplies and sums them. An interval missing
 * either value (no telemetry yet, or no price) simply doesn't contribute
 * — never fabricated as zero or interpolated.
 *
 * Extracted from `market/page.tsx` (Final Dashboard UX Refinement
 * milestone) so the Dashboard's Revenue KPI card uses this exact same
 * function, never a second implementation — see that page and
 * `dashboard/dashboard-data.ts` for the two call sites.
 */
export function computeExportRevenue(
  priceSeries: MarketPricePoint[],
  settlementEnergySeries: SettlementEnergyPoint[],
): RevenueSummary {
  const priceByTime = new Map(
    priceSeries
      .filter((point): point is MarketPricePoint & { price: number } => point.price !== null)
      .map((point) => [point.timestamp.getTime(), point.price]),
  );

  let revenueEur = 0;
  let exportedKwh = 0;
  let intervalsWithData = 0;

  for (const point of settlementEnergySeries) {
    if (point.exportedKwh === null) {
      continue;
    }

    const price = priceByTime.get(point.intervalStart.getTime());

    if (price === undefined) {
      continue;
    }

    const intervalRevenue = computeIntervalExportRevenueEur(point.exportedKwh, price);

    if (intervalRevenue === null) {
      continue;
    }

    revenueEur += intervalRevenue;
    exportedKwh += point.exportedKwh;
    intervalsWithData += 1;
  }

  if (intervalsWithData === 0) {
    return { available: false };
  }

  return {
    available: true,
    revenueEur: Math.round(revenueEur * 100) / 100,
    exportedKwh: Math.round(exportedKwh * 100) / 100,
    averagePriceEurPerMwh:
      exportedKwh > 0
        ? Math.round((revenueEur / (exportedKwh / 1000)) * 100) / 100
        : null,
  };
}
