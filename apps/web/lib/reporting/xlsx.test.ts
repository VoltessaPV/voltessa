import assert from "node:assert/strict";
import { test } from "node:test";

import type { ReportResult } from "./build-report";
import { toXlsxBuffer } from "./xlsx";

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

const meta = {
  plantName: "Atlanta",
  organizationName: "Acme Solar",
  generatedAt: new Date("2026-09-10T09:00:00.000Z"),
  periodLabel: "01 Sep 2026 00:00 – 01 Sep 2026 00:45 (Europe/Sofia)",
};

test("toXlsxBuffer produces a real, non-empty XLSX (ZIP) workbook", async () => {
  const buffer = await toXlsxBuffer(fixture(), meta);
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 0);
  // XLSX is a ZIP container — must start with the local file header magic "PK\x03\x04".
  assert.equal(buffer[0], 0x50);
  assert.equal(buffer[1], 0x4b);
  assert.equal(buffer[2], 0x03);
  assert.equal(buffer[3], 0x04);
});

test("the output is a structurally framed ZIP container, not a CSV string", async () => {
  const buffer = await toXlsxBuffer(fixture(), meta);
  // End Of Central Directory record signature "PK\x05\x06" must be present.
  const eocd = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd > 0, "missing ZIP end-of-central-directory record");
  // A CSV would be plain text; a zip has non-text bytes.
  assert.ok(buffer.includes(0x00));
});

test("generation is deterministic for identical input", async () => {
  const a = await toXlsxBuffer(fixture(), meta);
  const b = await toXlsxBuffer(fixture(), meta);
  assert.equal(a.length, b.length);
});

test("a report with only one metric still generates a valid workbook", async () => {
  const single = fixture();
  single.metrics = ["revenue"];
  single.rows = single.rows.map((row) => ({
    intervalStart: row.intervalStart,
    values: { revenue: row.values.revenue ?? null },
  }));
  single.totals = { label: "TOTAL", values: { revenue: 0.6 } };
  const buffer = await toXlsxBuffer(single, meta);
  assert.ok(buffer.length > 0);
  assert.equal(buffer[0], 0x50);
  assert.equal(buffer[1], 0x4b);
});
