import assert from "node:assert/strict";
import { test } from "node:test";

import { toDetailCsv } from "./csv";
import { DETAIL_COLUMNS, simulationFilename } from "./format";
import {
  runSimulation,
  type SimulationInputInterval,
  type SimulationMode,
} from "./simulate";

const BASE = Date.UTC(2026, 4, 1, 21, 0, 0); // 2026-05-02 00:00 Europe/Sofia
const STEP = 15 * 60 * 1000;
const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

function iv(i: number, load: number | null, ref: number | null): SimulationInputInterval {
  const start = new Date(BASE + i * STEP);
  const local = new Date(start.getTime() + 3 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    intervalStartUtc: start,
    localLabel: `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())} ${p(local.getUTCHours())}:${p(local.getUTCMinutes())}`,
    loadKwh: load,
    referencePvKwh: ref,
    inputQuality: "ok",
  };
}

function fixture(mode: SimulationMode = "self_consumption_plus_export") {
  return runSimulation(
    [iv(0, 60, 13.63), iv(1, null, 10), iv(2, 40, null), iv(3, 20, 30)],
    { targetCapacityKwp: 500, referenceCapacityKwp: 100, mode },
    "Europe/Sofia",
  );
}

test("CSV starts with a UTF-8 BOM and uses CRLF", () => {
  const csv = toDetailCsv(fixture());
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.includes("\r\n"));
  assert.ok(!csv.replace(/\r\n/g, "").includes("\n"));
});

test("header is the fixed 13-column detail layout", () => {
  const lines = stripBom(toDetailCsv(fixture())).split("\r\n");
  assert.equal(lines[0], DETAIL_COLUMNS.map((c) => c.header).join(","));
});

test("one row per interval then a final TOTAL row; missing values are blank, never 0", () => {
  const lines = stripBom(toDetailCsv(fixture())).replace(/\r\n$/, "").split("\r\n");
  // header + 4 intervals + TOTAL
  assert.equal(lines.length, 6);
  // interval 1 has no load -> quality missing_load, energy cells blank
  const row1 = lines[2]!.split(",");
  assert.equal(row1[0], "2026-05-02 00:15");
  assert.equal(row1[1], "missing_load");
  assert.equal(row1[2], ""); // consumption blank
  assert.equal(row1[6], ""); // grid import without PV blank
  // interval 2 has no reference PV -> load kept, grid import unchanged, PV columns blank
  const row2 = lines[3]!.split(",");
  assert.equal(row2[1], "no_reference_pv");
  assert.equal(row2[2], "40.000");
  assert.equal(row2[4], ""); // simulated PV blank — production is not invented
  assert.equal(row2[5], ""); // PV used blank
  assert.equal(row2[6], "40.000"); // grid import without PV present
  assert.equal(row2[7], "40.000"); // grid import with PV == load (no PV)
  // final row is TOTAL, not a timestamp
  const total = lines[5]!.split(",");
  assert.equal(total[0], "TOTAL");
  // consumption total = 60 + 40 + 20 = 120 (the null excluded)
  assert.equal(total[2], "120.000");
  // grid import with PV total = 0 (iv0) + 40 (iv2, no PV) + 0 (iv3) = 40.000
  assert.equal(total[7], "40.000");
});

test("interval ordering is preserved exactly", () => {
  const lines = stripBom(toDetailCsv(fixture())).replace(/\r\n$/, "").split("\r\n").slice(1, -1);
  assert.deepEqual(
    lines.map((l) => l.split(",")[0]),
    ["2026-05-02 00:00", "2026-05-02 00:15", "2026-05-02 00:30", "2026-05-02 00:45"],
  );
});

test("filenames are safe and deterministic", () => {
  const f = simulationFilename(
    'Чомаковци "100KW", Site/1',
    500,
    "self_consumption_only",
    "2026-01-01",
    "2026-05-31",
    "csv",
  );
  assert.equal(f, "voltessa-pv-sim-100kw-site-1-500kwp-selfcons-2026-01-01-2026-05-31.csv");
  assert.ok(!f.includes("/"));
  assert.ok(!f.includes(".."));
  assert.ok(!f.includes('"'));

  const x = simulationFilename("Chomakovtsi", 333.5, "self_consumption_plus_export", "2026-01-01", "2026-05-31", "xlsx");
  assert.match(x, /^voltessa-pv-sim-chomakovtsi-333\.5kwp-export-2026-01-01-2026-05-31\.xlsx$/);
});
