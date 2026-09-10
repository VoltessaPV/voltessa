import assert from "node:assert/strict";
import { test } from "node:test";

import type { ReportResult } from "./build-report";
import { csvField, toCsv } from "./csv";
import {
  formatIntervalTimestamp,
  formatMetricValue,
  reportFilename,
  slugifyPlantName,
} from "./serialize";

const BOM = String.fromCharCode(0xfeff);
const stripBom = (value: string): string => (value.charCodeAt(0) === 0xfeff ? value.slice(1) : value);

const BASE = Date.UTC(2026, 8, 1, 0, 0, 0);
const STEP = 15 * 60 * 1000;

function fixture(): ReportResult {
  return {
    timeZone: "Europe/Sofia",
    currency: "EUR",
    intervalMinutes: 15,
    periodStartUtc: new Date(BASE),
    periodEndUtc: new Date(BASE + 3 * STEP),
    metrics: ["pvProduction", "gridExport", "price", "revenue"],
    rows: [
      {
        intervalStart: new Date(BASE),
        values: { pvProduction: 10, gridExport: 6, price: 100, revenue: 0.6 },
      },
      {
        intervalStart: new Date(BASE + STEP),
        values: { pvProduction: null, gridExport: null, price: 50, revenue: null },
      },
      {
        intervalStart: new Date(BASE + 2 * STEP),
        values: { pvProduction: 4, gridExport: 0, price: null, revenue: null },
      },
    ],
    totals: {
      label: "TOTAL",
      values: { pvProduction: 14, gridExport: 6, price: 100, revenue: 0.6 },
    },
    completeness: [],
    priceImportPartial: false,
    rowCount: 3,
    revenue: { available: true, revenueEur: 0.6, exportedKwh: 6, averagePriceEurPerMwh: 100 },
  };
}

test("csvField quotes commas, quotes, CR and LF and doubles embedded quotes", () => {
  assert.equal(csvField("plain"), "plain");
  assert.equal(csvField("a,b"), '"a,b"');
  assert.equal(csvField('he said "hi"'), '"he said ""hi"""');
  assert.equal(csvField("line1\nline2"), '"line1\nline2"');
  assert.equal(csvField("line1\r\nline2"), '"line1\r\nline2"');
  assert.equal(csvField(""), "");
});

test("CSV starts with a UTF-8 BOM and uses CRLF line endings", () => {
  const csv = toCsv(fixture());
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.startsWith(BOM));
  assert.ok(csv.includes("\r\n"));
  // no bare LF anywhere once CRLF pairs are removed
  assert.ok(!csv.replace(/\r\n/g, "").includes("\n"));
});

test("CSV header is Timestamp + only the selected metric columns, in order, with units", () => {
  const lines = stripBom(toCsv(fixture())).split("\r\n");
  assert.equal(
    lines[0],
    "Timestamp,PV Production (kWh),Grid Export (kWh),Price (EUR/MWh),Revenue (EUR)",
  );
  assert.ok(!lines[0].includes("Total Consumption"));
  assert.ok(!lines[0].includes("Grid Consumption"));
});

test("CSV has one line per interval then a final TOTAL line; missing values are empty fields", () => {
  const lines = stripBom(toCsv(fixture())).replace(/\r\n$/, "").split("\r\n");
  // header + 3 rows + total ; timestamps are Europe/Sofia (UTC+3 in September)
  assert.equal(lines.length, 5);
  assert.equal(lines[1], "2026-09-01 03:00,10.000,6.000,100.00,0.6000");
  // second interval: pv/export/revenue missing -> empty; price present
  assert.equal(lines[2], "2026-09-01 03:15,,,50.00,");
  // third interval: price/revenue missing -> empty; export is a real 0
  assert.equal(lines[3], "2026-09-01 03:30,4.000,0.000,,");
  // final line is the TOTAL row, not a timestamp
  assert.equal(lines[4], "TOTAL,14.000,6.000,100.00,0.6000");
  assert.ok(lines[4].startsWith("TOTAL,"));
});

test("formatMetricValue: null -> empty string, never 0", () => {
  assert.equal(formatMetricValue(null, "pvProduction"), "");
  assert.equal(formatMetricValue(0, "pvProduction"), "0.000");
  assert.equal(formatMetricValue(0, "gridExport"), "0.000");
  assert.equal(formatMetricValue(85.7142857, "price"), "85.71");
  assert.equal(formatMetricValue(0.6, "revenue"), "0.6000");
});

test("formatIntervalTimestamp renders the plant-local wall clock, DST-correct", () => {
  // 2026-09-01 is EEST (UTC+3) in Sofia
  assert.equal(
    formatIntervalTimestamp(new Date("2026-09-01T00:00:00.000Z"), "Europe/Sofia"),
    "2026-09-01 03:00",
  );
  // 2026-01-01 is EET (UTC+2) in Sofia
  assert.equal(
    formatIntervalTimestamp(new Date("2026-01-01T00:00:00.000Z"), "Europe/Sofia"),
    "2026-01-01 02:00",
  );
});

test("slugifyPlantName strips path separators, traversal, unicode and control chars", () => {
  assert.equal(slugifyPlantName("Atlanta"), "atlanta");
  assert.equal(slugifyPlantName("Plant A / B"), "plant-a-b");
  assert.equal(slugifyPlantName("../../etc/passwd"), "etc-passwd");
  assert.equal(slugifyPlantName("..\\..\\windows"), "windows");
  assert.equal(slugifyPlantName('He said "hi", ok?'), "he-said-hi-ok");
  assert.equal(slugifyPlantName("   "), "plant");
  assert.equal(slugifyPlantName(""), "plant");
  assert.equal(slugifyPlantName("Солар Парк"), "plant"); // non-ASCII collapses away
  assert.ok(!slugifyPlantName("x".repeat(200)).includes("/"));
  assert.ok(slugifyPlantName("x".repeat(200)).length <= 60);
});

test("reportFilename is deterministic, safe, and carries plant + period", () => {
  const name = reportFilename(
    'Atlanta "Main", Site/1',
    new Date("2026-09-01T21:00:00.000Z"),
    new Date("2026-09-08T21:00:00.000Z"),
    "Europe/Sofia",
    "csv",
  );
  assert.equal(name, "voltessa-atlanta-main-site-1-report-2026-09-02-2026-09-08.csv");
  assert.ok(!name.includes("/"));
  assert.ok(!name.includes(".."));
  assert.ok(!name.includes('"'));

  const xlsx = reportFilename(
    "Atlanta",
    new Date("2026-09-01T21:00:00.000Z"),
    new Date("2026-09-08T21:00:00.000Z"),
    "Europe/Sofia",
    "xlsx",
  );
  assert.match(xlsx, /^voltessa-atlanta-report-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.xlsx$/);
});
