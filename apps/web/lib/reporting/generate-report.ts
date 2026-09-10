/**
 * Admin Reporting feature — orchestration. Fetches the canonical series for
 * a validated request and hands them to the pure `buildReport`. This is the
 * only file in the feature that performs I/O, and it performs it exclusively
 * through existing canonical entry points:
 *
 * - `getPlantProductionEnergySeries` / `getPlantSettlementEnergySeries`
 *   (`lib/telemetry/energy-metrics.ts`) — the Energy/Settlement Engines,
 *   the same functions the Market page uses for its 15-minute chart.
 * - `dbMarketPriceProvider.getPricesInRange` / `.getLatestImportStatus`
 *   (`lib/market-price/provider.ts`) — persisted `MarketPrice` rows only,
 *   never a live ENTSO-E/IBEX call.
 *
 * No Huawei call, no browser automation, no telemetry write — read-only.
 */

import { DEFAULT_BIDDING_ZONE } from "@/lib/market-price/constants";
import { dbMarketPriceProvider } from "@/lib/market-price/provider";
import {
  getPlantProductionEnergySeries,
  getPlantSettlementEnergySeries,
} from "@/lib/telemetry/energy-metrics";

import { buildReport, type ReportResult } from "./build-report";
import { REPORT_INTERVAL_MINUTES, type MetricKey } from "./metrics";

const INTERVAL_MS = REPORT_INTERVAL_MINUTES * 60 * 1000;

export type GenerateReportParams = {
  plantId: string;
  timeZone: string;
  startUtc: Date;
  endUtc: Date;
  metrics: readonly MetricKey[];
};

/** Builds the 15-minute UTC interval grid for `[start, end)` — the exact grid every series shares. */
function buildIntervalGrid(startUtc: Date, endUtc: Date): Date[] {
  const intervals: Date[] = [];
  for (let t = startUtc.getTime(); t < endUtc.getTime(); t += INTERVAL_MS) {
    intervals.push(new Date(t));
  }
  return intervals;
}

export async function generateReport(params: GenerateReportParams): Promise<ReportResult> {
  const { plantId, timeZone, startUtc, endUtc, metrics } = params;

  const [productionSeries, settlementSeries, priceResult, importStatus] = await Promise.all([
    getPlantProductionEnergySeries(plantId, startUtc, endUtc),
    getPlantSettlementEnergySeries(plantId, startUtc, endUtc),
    dbMarketPriceProvider.getPricesInRange({
      start: startUtc,
      end: endUtc,
      biddingZone: DEFAULT_BIDDING_ZONE,
    }),
    dbMarketPriceProvider.getLatestImportStatus({ biddingZone: DEFAULT_BIDDING_ZONE }),
  ]);

  const priceSeries = priceResult.available
    ? priceResult.prices.map((price) => ({ timestamp: price.timestamp, price: price.price }))
    : [];
  const currency = priceResult.available
    ? (priceResult.prices[0]?.currency ?? "EUR")
    : "EUR";

  const hasMeterData = settlementSeries.some(
    (point) => point.exportedKwh !== null || point.importedKwh !== null,
  );

  return buildReport({
    intervals: buildIntervalGrid(startUtc, endUtc),
    productionSeries,
    settlementSeries,
    priceSeries,
    currency,
    hasMeterData,
    metrics,
    timeZone,
    periodStartUtc: startUtc,
    periodEndUtc: endUtc,
    priceImportPartial: importStatus.available ? importStatus.isPartial : false,
  });
}
