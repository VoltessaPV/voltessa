import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  ProductionEnergyPoint,
  SettlementEnergyPoint,
} from "@/lib/telemetry/energy-metrics";

import {
  buildReport,
  type BuildReportInput,
  type ReportPricePoint,
  type ReportResult,
  type ReportRow,
} from "./build-report";
import { METRIC_KEYS, type MetricKey } from "./metrics";

function rowAt(report: ReportResult, index: number): ReportRow {
  const row = report.rows[index];
  assert.ok(row, `expected a row at index ${index}`);
  return row;
}

const BASE = Date.UTC(2026, 8, 1, 0, 0, 0); // 2026-09-01T00:00:00Z
const STEP = 15 * 60 * 1000;
const at = (i: number) => new Date(BASE + i * STEP);

const intervals = [at(0), at(1), at(2), at(3)];

const productionSeries: ProductionEnergyPoint[] = [
  { intervalStart: at(0), producedKwh: 10 },
  { intervalStart: at(1), producedKwh: 20 },
  { intervalStart: at(2), producedKwh: null }, // missing
  { intervalStart: at(3), producedKwh: 4 },
];

const settlementSeries: SettlementEnergyPoint[] = [
  { intervalStart: at(0), exportedKwh: 6, importedKwh: 0 },
  { intervalStart: at(1), exportedKwh: 15, importedKwh: 0 },
  { intervalStart: at(2), exportedKwh: null, importedKwh: null }, // missing
  { intervalStart: at(3), exportedKwh: 0, importedKwh: 3 },
];

const priceSeries: ReportPricePoint[] = [
  { timestamp: at(0), price: 100 },
  { timestamp: at(1), price: 80 },
  { timestamp: at(2), price: 50 },
  { timestamp: at(3), price: null }, // missing
];

function input(overrides: Partial<BuildReportInput> = {}): BuildReportInput {
  return {
    intervals,
    productionSeries,
    settlementSeries,
    priceSeries,
    currency: "EUR",
    hasMeterData: true,
    metrics: [...METRIC_KEYS],
    timeZone: "Europe/Sofia",
    periodStartUtc: at(0),
    periodEndUtc: at(4),
    priceImportPartial: false,
    ...overrides,
  };
}

test("each metric maps to its canonical per-interval value", () => {
  const report = buildReport(input());
  const r0 = rowAt(report, 0);
  const r1 = rowAt(report, 1);
  const r2 = rowAt(report, 2);
  const r3 = rowAt(report, 3);

  // PV Production -> getPlantProductionEnergySeries().producedKwh
  assert.equal(r0.values.pvProduction, 10);
  assert.equal(r2.values.pvProduction, null);

  // Grid Export -> settlement exportedKwh ; Grid Consumption -> importedKwh
  assert.equal(r1.values.gridExport, 15);
  assert.equal(r3.values.gridConsumption, 3);
  assert.equal(r2.values.gridExport, null);

  // PV Consumption -> computeConsumedFromPv(produced, exported) = produced - export
  assert.equal(r0.values.pvConsumption, 4); // 10 - 6
  assert.equal(r1.values.pvConsumption, 5); // 20 - 15

  // Total Consumption -> produced + import - export
  assert.equal(r0.values.totalConsumption, 4); // 10 + 0 - 6
  assert.equal(r3.values.totalConsumption, 7); // 4 + 3 - 0

  // Price -> the market price for that interval instant
  assert.equal(r0.values.price, 100);

  // Revenue -> exported * price / 1000
  assert.equal(r0.values.revenue, 0.6); // 6 * 100 / 1000
  assert.equal(r1.values.revenue, 1.2); // 15 * 80 / 1000
});

test("a missing input stays null in every derived metric — never coerced to 0", () => {
  const report = buildReport(input());
  const r2 = rowAt(report, 2);
  assert.equal(r2.values.pvProduction, null);
  assert.equal(r2.values.gridExport, null);
  assert.equal(r2.values.gridConsumption, null);
  assert.equal(r2.values.pvConsumption, null);
  assert.equal(r2.values.totalConsumption, null);

  // interval 3: real export of 0 but no price -> revenue is null, not 0
  const r3 = rowAt(report, 3);
  assert.equal(r3.values.revenue, null);
  assert.equal(r3.values.price, null);
});

test("one row per 15-minute interval, in order — no aggregation", () => {
  const report = buildReport(input());
  assert.equal(report.rows.length, 4);
  assert.equal(report.rowCount, 4);
  assert.deepEqual(
    report.rows.map((row) => row.intervalStart.getTime()),
    intervals.map((d) => d.getTime()),
  );
});

test("TOTAL row: energy metrics are SUMMED over intervals that have a value", () => {
  const report = buildReport(input());
  assert.equal(report.totals.label, "TOTAL");
  assert.equal(report.totals.values.pvProduction, 34); // 10 + 20 + 4
  assert.equal(report.totals.values.gridExport, 21); // 6 + 15 + 0
  assert.equal(report.totals.values.gridConsumption, 3); // 0 + 0 + 3
});

test("TOTAL row: PV Consumption and Total Consumption use the canonical identities over period totals", () => {
  const report = buildReport(input());
  // computeConsumedFromPv(sum produced 34, sum exported 21) = 13
  assert.equal(report.totals.values.pvConsumption, 13);
  // sum produced 34 + sum imported 3 - sum exported 21 = 16
  assert.equal(report.totals.values.totalConsumption, 16);
});

test("TOTAL row: Revenue is SUMMED; Price is an export-weighted average, never summed", () => {
  const report = buildReport(input());

  // Revenue total = 0.6 + 1.2 = 1.8  (canonical computeExportRevenue.revenueEur)
  assert.equal(report.totals.values.revenue, 1.8);

  // Price total must NOT be the sum of prices (100 + 80 + 50 = 230)
  assert.notEqual(report.totals.values.price, 230);
  // Export-weighted: (6*100 + 15*80) / (6 + 15) = 1800 / 21 = 85.714... -> 85.71
  assert.equal(report.totals.values.price, 85.71);

  assert.ok(report.revenue.available);
  if (report.revenue.available) {
    assert.equal(report.revenue.revenueEur, 1.8);
    assert.equal(report.revenue.averagePriceEurPerMwh, 85.71);
  }
});

test("TOTAL Price weighting matches Σ(export·price) / Σ(export) exactly", () => {
  const report = buildReport(input());
  const weighted = (6 * 100 + 15 * 80) / (6 + 15);
  assert.equal(report.totals.values.price, Math.round(weighted * 100) / 100);
});

test("only selected metrics appear in rows and in the TOTAL row", () => {
  const selected: MetricKey[] = ["pvProduction", "gridExport"];
  const report = buildReport(input({ metrics: selected }));

  assert.deepEqual(report.metrics, selected);
  for (const row of report.rows) {
    assert.deepEqual(Object.keys(row.values).sort(), [...selected].sort());
  }
  assert.deepEqual(Object.keys(report.totals.values).sort(), [...selected].sort());
  assert.equal("price" in report.totals.values, false);
  assert.equal("revenue" in report.totals.values, false);
});

test("metrics are always emitted in canonical column order regardless of selection order", () => {
  const report = buildReport(input({ metrics: ["revenue", "gridExport", "pvProduction"] }));
  assert.deepEqual(report.metrics, ["pvProduction", "gridExport", "revenue"]);
});

test("completeness counts real (including zero) values, not nulls", () => {
  const report = buildReport(input());
  const byMetric = Object.fromEntries(report.completeness.map((c) => [c.metric, c]));
  assert.deepEqual(byMetric.pvProduction, { metric: "pvProduction", withData: 3, total: 4 });
  assert.deepEqual(byMetric.gridExport, { metric: "gridExport", withData: 3, total: 4 }); // includes the 0
  assert.deepEqual(byMetric.revenue, { metric: "revenue", withData: 2, total: 4 });
});

test("no telemetry and no prices: every value and every total is blank, revenue unavailable", () => {
  const report = buildReport(
    input({
      productionSeries: [],
      settlementSeries: [],
      priceSeries: [],
      hasMeterData: false,
    }),
  );
  assert.equal(report.rows.length, 4);
  for (const row of report.rows) {
    for (const key of METRIC_KEYS) {
      assert.equal(row.values[key], null);
    }
  }
  for (const key of METRIC_KEYS) {
    assert.equal(report.totals.values[key], null);
  }
  assert.equal(report.revenue.available, false);
});

test("Producer fallback: a meterless plant prices Revenue against real produced energy", () => {
  // no meter data at all
  const meterless: SettlementEnergyPoint[] = intervals.map((d) => ({
    intervalStart: d,
    exportedKwh: null,
    importedKwh: null,
  }));
  const report = buildReport(input({ settlementSeries: meterless, hasMeterData: false }));
  const r0 = rowAt(report, 0);
  const r1 = rowAt(report, 1);

  // Export / import / self-consumption / total-consumption unavailable without a meter
  assert.equal(r0.values.gridExport, null);
  assert.equal(r0.values.pvConsumption, null);
  assert.equal(r0.values.totalConsumption, null);

  // Revenue interval 0 = produced 10 * price 100 / 1000 = 1.0
  assert.equal(r0.values.revenue, 1);
  assert.equal(r1.values.revenue, (20 * 80) / 1000); // 1.6

  // Revenue total = 1.0 + 1.6 = 2.6 ; weighted price = (10*100 + 20*80)/(10+20) = 86.67
  assert.equal(report.totals.values.revenue, 2.6);
  assert.equal(report.totals.values.price, Math.round((2600 / 30) * 100) / 100);
});

test("a large, realistic period assembles without per-interval blow-up", () => {
  const count = 93 * 96; // 93 days at 15-minute resolution
  const grid: Date[] = [];
  const production: ProductionEnergyPoint[] = [];
  const settlement: SettlementEnergyPoint[] = [];
  const prices: ReportPricePoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const ts = new Date(BASE + i * STEP);
    grid.push(ts);
    production.push({ intervalStart: ts, producedKwh: 1 });
    settlement.push({ intervalStart: ts, exportedKwh: 0.5, importedKwh: 0 });
    prices.push({ timestamp: ts, price: 100 });
  }

  const report = buildReport(
    input({
      intervals: grid,
      productionSeries: production,
      settlementSeries: settlement,
      priceSeries: prices,
      periodStartUtc: new Date(BASE),
      periodEndUtc: new Date(BASE + count * STEP),
    }),
  );

  assert.equal(report.rows.length, count);
  assert.equal(report.totals.values.gridExport, 0.5 * count);
  // revenue total = 0.5 kWh * 100 EUR/MWh / 1000 * count
  assert.equal(report.totals.values.revenue, Math.round(((0.5 * 100) / 1000) * count * 100) / 100);
  assert.equal(report.totals.values.price, 100);
});
