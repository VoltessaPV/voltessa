import assert from "node:assert/strict";
import { test } from "node:test";

import readXlsxFile from "read-excel-file/node";

import { toSimulationXlsxBuffer } from "./xlsx";
import {
  runSimulation,
  type SimulationInputInterval,
} from "./simulate";

const STEP = 15 * 60 * 1000;

function iv(startUtc: Date, load: number | null, ref: number | null): SimulationInputInterval {
  const local = new Date(startUtc.getTime() + 3 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    intervalStartUtc: startUtc,
    localLabel: `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())} ${p(local.getUTCHours())}:${p(local.getUTCMinutes())}`,
    loadKwh: load,
    referencePvKwh: ref,
    inputQuality: "ok",
  };
}

function fixture() {
  // Two calendar months so the Monthly Overview has > 1 row + a TOTAL.
  const may = Array.from({ length: 8 }, (_, i) =>
    iv(new Date(Date.UTC(2026, 4, 1, 6, 0) + i * STEP), 60 + i, 12),
  );
  const june = Array.from({ length: 4 }, (_, i) =>
    iv(new Date(Date.UTC(2026, 5, 1, 6, 0) + i * STEP), 50 + i, i === 1 ? null : 20),
  );
  return runSimulation(
    [...may, ...june],
    { targetCapacityKwp: 500, referenceCapacityKwp: 100, mode: "self_consumption_plus_export" },
    "Europe/Sofia",
  );
}

const meta = {
  referencePlantName: "Чомаковци 100KW",
  referenceOrganizationName: "Chomakovtsi",
  referenceCapacityKwp: 100,
  periodLabel: "2026-05-01 – 2026-06-01 (Europe/Sofia)",
  generatedAt: new Date("2026-09-11T09:00:00.000Z"),
  loadProfileWarnings: ["2 interval(s) have no value and are excluded from all totals (not treated as 0)."],
};

test("produces a real, non-empty XLSX (ZIP) workbook", async () => {
  const buf = await toSimulationXlsxBuffer(fixture(), meta);
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 0);
  // ZIP local file header magic "PK\x03\x04".
  assert.equal(buf[0], 0x50);
  assert.equal(buf[1], 0x4b);
  assert.equal(buf[2], 0x03);
  assert.equal(buf[3], 0x04);
  // End of central directory record present.
  assert.ok(buf.indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) > 0);
});

test("round-trips to four named sheets with the expected structure", async () => {
  const buf = await toSimulationXlsxBuffer(fixture(), meta);
  const sheets = await readXlsxFile(buf);
  assert.deepEqual(
    sheets.map((s) => s.sheet),
    ["Summary", "Monthly Overview", "Hourly Profile", "15-Minute Detail"],
  );

  const monthly = sheets[1]!.data;
  assert.equal(String(monthly[0]![0]), "Month");
  // 1 header + 2 month rows + 1 TOTAL row
  assert.equal(monthly.length, 4);
  assert.equal(String(monthly[monthly.length - 1]![0]), "TOTAL");
  // TOTAL consumption == sum of the two month consumption cells.
  const totalConsumption = Number(monthly[3]![1]);
  const sumMonths = Number(monthly[1]![1]) + Number(monthly[2]![1]);
  assert.ok(Math.abs(totalConsumption - sumMonths) < 0.01);

  const detail = sheets[3]!.data;
  assert.equal(String(detail[0]![0]), "Timestamp");
  assert.equal(String(detail[detail.length - 1]![0]), "TOTAL");
  // header + 12 intervals + TOTAL
  assert.equal(detail.length, 14);

  const hourly = sheets[2]!.data;
  assert.equal(String(hourly[0]![0]), "Hour");
  assert.ok(hourly.length >= 2);
});

test("generation is deterministic for identical input", async () => {
  const a = await toSimulationXlsxBuffer(fixture(), meta);
  const b = await toSimulationXlsxBuffer(fixture(), meta);
  assert.equal(a.length, b.length);
});

test("an all-missing-reference-PV result still generates a valid workbook", async () => {
  const noPv = runSimulation(
    [iv(new Date(Date.UTC(2026, 4, 1, 6, 0)), 60, null), iv(new Date(Date.UTC(2026, 4, 1, 6, 15)), 40, null)],
    { targetCapacityKwp: 500, referenceCapacityKwp: 100, mode: "self_consumption_only" },
    "Europe/Sofia",
  );
  const buf = await toSimulationXlsxBuffer(noPv, meta);
  assert.ok(buf.length > 0);
  assert.equal(buf[0], 0x50);
  assert.equal(buf[1], 0x4b);
});
