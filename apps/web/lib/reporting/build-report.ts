/**
 * Admin Reporting feature — the pure assembly of a 15-minute interval
 * report from already-fetched canonical series. No I/O: every input is
 * produced by an existing canonical function and passed in by
 * `lib/reporting/generate-report.ts`. Unit-tested in `build-report.test.ts`.
 *
 * ## Metric → canonical source (one source of truth per metric)
 *
 * | Metric              | Per-interval value                                                                 |
 * | ------------------- | --------------------------------------------------------------------------------- |
 * | PV Production        | `getPlantProductionEnergySeries().producedKwh` (Energy Engine)                    |
 * | Grid Export          | `getPlantSettlementEnergySeries().exportedKwh` (meter `activeEnergy` counter Δ)   |
 * | Grid Consumption     | `getPlantSettlementEnergySeries().importedKwh` (meter `reverseActiveEnergy` Δ)    |
 * | PV Consumption        | `computeConsumedFromPv(produced, exported)` — the canonical Self-Consumption identity |
 * | Total Consumption     | `produced + imported − exported` — the canonical energy-flow identity (`deriveEnergyFlow`) |
 * | Price                 | `MarketPrice` row for the interval instant, via `dbMarketPriceProvider` (EUR/MWh) |
 * | Revenue               | `computeIntervalExportRevenueEur(exported, price)` — the canonical per-interval revenue formula |
 *
 * For a plant with **no real meter** (no settlement-energy data at all),
 * Grid Export / Grid Consumption / PV Consumption / Total Consumption stay
 * `null`, and Revenue is priced against real produced energy instead —
 * exactly the Producer fallback the Market page already uses
 * (`computeExportRevenue` fed `productionEnergySeries`). Atlanta has a
 * meter and never reaches the fallback.
 *
 * ## Missing data
 *
 * A `null` in any source stays `null` in the report — never coerced to `0`.
 * A derived metric is `null` whenever any of its inputs is `null` (or, for
 * Total Consumption, whenever the identity would go negative — a genuine
 * disagreement between independently-measured quantities, per
 * `computeConsumedFromPv`/`deriveEnergyFlow`).
 *
 * ## TOTAL row
 *
 * The final row of every report. Never a 15-minute interval — its first
 * cell is the literal `TOTAL`.
 *
 * - PV Production, Grid Export, Grid Consumption, Revenue → **SUM** over
 *   the intervals that have a value. `null` (blank) if none do.
 * - PV Consumption total → `computeConsumedFromPv(Σ produced, Σ exported)`
 *   (the same identity applied to the period totals).
 * - Total Consumption total → `Σ produced + Σ imported − Σ exported` (the
 *   same energy-flow identity applied to the period totals); `null` if any
 *   of the three period sums has no data, or the result is negative.
 * - Price total → **export-energy-weighted average**,
 *   `Σ(export_i · price_i) / Σ export_i` in EUR/MWh — identical to
 *   `RevenueSummary.averagePriceEurPerMwh` (revenue ÷ exported MWh). For a
 *   meterless plant the weight is produced energy, consistent with how that
 *   plant's Revenue is priced. Price is **never** summed. `null` if there
 *   is no weighting energy.
 * - Revenue total → `RevenueSummary.revenueEur` from the canonical
 *   `computeExportRevenue` (rounded to cents, as everywhere else in
 *   Voltessa).
 */

import {
  computeExportRevenue,
  computeIntervalExportRevenueEur,
  type RevenueSummary,
} from "@/lib/market-price/revenue";
import type { MarketPricePoint } from "@/app/[locale]/(platform)/market/market-data";
import {
  computeConsumedFromPv,
  type ProductionEnergyPoint,
  type SettlementEnergyPoint,
} from "@/lib/telemetry/energy-metrics";

import { REPORT_INTERVAL_MINUTES, orderMetrics, type MetricKey } from "./metrics";

export type ReportPricePoint = { timestamp: Date; price: number | null };

export type BuildReportInput = {
  /** Ascending 15-minute interval-start instants — the exact grid every series shares. */
  intervals: Date[];
  productionSeries: ProductionEnergyPoint[];
  settlementSeries: SettlementEnergyPoint[];
  priceSeries: ReportPricePoint[];
  /** From `MarketPrice.currency`; `"EUR"` today. */
  currency: string;
  /** Whether the plant has any real meter settlement data in the window. */
  hasMeterData: boolean;
  metrics: readonly MetricKey[];
  timeZone: string;
  periodStartUtc: Date;
  periodEndUtc: Date;
  /** `MarketPriceImport.isPartial` for the most recent import — surfaced in the summary, never changes a value. */
  priceImportPartial: boolean;
};

export type ReportRow = {
  intervalStart: Date;
  /** Only the selected metrics are present. `null` = missing, never `0`. */
  values: Partial<Record<MetricKey, number | null>>;
};

export type ReportTotals = {
  label: "TOTAL";
  values: Partial<Record<MetricKey, number | null>>;
};

export type MetricCompleteness = {
  metric: MetricKey;
  withData: number;
  total: number;
};

export type ReportResult = {
  timeZone: string;
  currency: string;
  intervalMinutes: number;
  periodStartUtc: Date;
  periodEndUtc: Date;
  metrics: MetricKey[];
  rows: ReportRow[];
  totals: ReportTotals;
  completeness: MetricCompleteness[];
  priceImportPartial: boolean;
  rowCount: number;
  /** Canonical revenue summary for the whole period — drives the two financial TOTAL cells and the UI summary. */
  revenue: RevenueSummary;
};

const round = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

type IntervalMetrics = {
  pvProduction: number | null;
  gridExport: number | null;
  gridConsumption: number | null;
  pvConsumption: number | null;
  totalConsumption: number | null;
  price: number | null;
  revenue: number | null;
};

function computeIntervalMetrics(
  produced: number | null,
  exported: number | null,
  imported: number | null,
  price: number | null,
  hasMeterData: boolean,
): IntervalMetrics {
  const pvConsumption = computeConsumedFromPv(produced, exported);

  let totalConsumption: number | null = null;
  if (produced !== null && exported !== null && imported !== null) {
    const value = produced + imported - exported;
    totalConsumption = value >= 0 ? round(value, 3) : null;
  }

  // Revenue is priced against real exported energy where a meter exists,
  // otherwise against real produced energy — the same Producer fallback
  // the Market page uses. One formula either way
  // (`computeIntervalExportRevenueEur`).
  const revenueEnergy = hasMeterData ? exported : produced;

  return {
    pvProduction: produced,
    gridExport: exported,
    gridConsumption: imported,
    pvConsumption,
    totalConsumption,
    price,
    revenue: computeIntervalExportRevenueEur(revenueEnergy, price),
  };
}

export function buildReport(input: BuildReportInput): ReportResult {
  const metrics = orderMetrics(input.metrics);

  const producedByTime = new Map(
    input.productionSeries.map((point) => [point.intervalStart.getTime(), point.producedKwh]),
  );
  const settlementByTime = new Map(
    input.settlementSeries.map((point) => [point.intervalStart.getTime(), point]),
  );
  const priceByTime = new Map(
    input.priceSeries.map((point) => [point.timestamp.getTime(), point.price]),
  );

  const rows: ReportRow[] = [];

  // Period sums, tracked per metric so a metric with zero data intervals
  // stays blank in TOTAL instead of showing a misleading 0.
  let producedSum = 0;
  let producedCount = 0;
  let exportedSum = 0;
  let exportedCount = 0;
  let importedSum = 0;
  let importedCount = 0;

  const completenessCounts: Record<MetricKey, number> = {
    pvProduction: 0,
    totalConsumption: 0,
    gridConsumption: 0,
    pvConsumption: 0,
    gridExport: 0,
    price: 0,
    revenue: 0,
  };

  for (const intervalStart of input.intervals) {
    const t = intervalStart.getTime();
    const produced = producedByTime.get(t) ?? null;
    const settlement = settlementByTime.get(t);
    const exported = settlement ? settlement.exportedKwh : null;
    const imported = settlement ? settlement.importedKwh : null;
    const price = priceByTime.get(t) ?? null;

    const computed = computeIntervalMetrics(produced, exported, imported, price, input.hasMeterData);

    if (produced !== null) {
      producedSum += produced;
      producedCount += 1;
    }
    if (exported !== null) {
      exportedSum += exported;
      exportedCount += 1;
    }
    if (imported !== null) {
      importedSum += imported;
      importedCount += 1;
    }

    const values: Partial<Record<MetricKey, number | null>> = {};
    for (const metric of metrics) {
      const raw = computed[metric];
      values[metric] = raw;
      if (raw !== null) {
        completenessCounts[metric] += 1;
      }
    }

    rows.push({ intervalStart, values });
  }

  const producedTotal = producedCount > 0 ? round(producedSum, 3) : null;
  const exportedTotal = exportedCount > 0 ? round(exportedSum, 3) : null;
  const importedTotal = importedCount > 0 ? round(importedSum, 3) : null;

  // Canonical Revenue Engine for the whole period — Revenue TOTAL and the
  // weighted-average Price TOTAL both come straight from its output, never
  // a second calculation. Fed the meter settlement series where one
  // exists, otherwise real produced energy mapped as the priced quantity
  // (identical to the Market page's Producer fallback).
  const priceSeriesForRevenue: MarketPricePoint[] = input.priceSeries.map((point) => ({
    timestamp: point.timestamp,
    price: point.price,
    exportEnabled: false,
  }));
  const energySeriesForRevenue: SettlementEnergyPoint[] = input.hasMeterData
    ? input.settlementSeries
    : input.productionSeries.map((point) => ({
        intervalStart: point.intervalStart,
        exportedKwh: point.producedKwh,
        importedKwh: null,
      }));
  const revenue = computeExportRevenue(priceSeriesForRevenue, energySeriesForRevenue);

  let totalConsumptionTotal: number | null = null;
  if (producedTotal !== null && exportedTotal !== null && importedTotal !== null) {
    const value = producedTotal + importedTotal - exportedTotal;
    totalConsumptionTotal = value >= 0 ? round(value, 3) : null;
  }

  const totalsByMetric: Record<MetricKey, number | null> = {
    pvProduction: producedTotal,
    gridExport: exportedTotal,
    gridConsumption: importedTotal,
    pvConsumption: computeConsumedFromPv(producedTotal, exportedTotal),
    totalConsumption: totalConsumptionTotal,
    // Price is NEVER summed — export/production-energy-weighted average.
    price: revenue.available ? revenue.averagePriceEurPerMwh : null,
    revenue: revenue.available ? round(revenue.revenueEur, 2) : null,
  };

  const totals: ReportTotals = { label: "TOTAL", values: {} };
  for (const metric of metrics) {
    totals.values[metric] = totalsByMetric[metric];
  }

  const completeness: MetricCompleteness[] = metrics.map((metric) => ({
    metric,
    withData: completenessCounts[metric],
    total: input.intervals.length,
  }));

  return {
    timeZone: input.timeZone,
    currency: input.currency,
    intervalMinutes: REPORT_INTERVAL_MINUTES,
    periodStartUtc: input.periodStartUtc,
    periodEndUtc: input.periodEndUtc,
    metrics,
    rows,
    totals,
    completeness,
    priceImportPartial: input.priceImportPartial,
    rowCount: rows.length,
    revenue,
  };
}
