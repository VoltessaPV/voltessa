import type { MarketPricePoint } from "@/app/(platform)/market/market-data";
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

    revenueEur += (point.exportedKwh * price) / 1000;
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
