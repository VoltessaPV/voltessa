import assert from "node:assert/strict";
import { test } from "node:test";

import { parseLoadProfile, type SheetRows } from "./load-profile";

const TZ = "Europe/Sofia";

/** 96 interval-END time header cells, as `read-excel-file` yields them (Excel-epoch Date objects). */
function header(): (Date | null)[] {
  const cells: (Date | null)[] = [null];
  for (let j = 1; j <= 95; j += 1) {
    const totalMin = j * 15;
    cells.push(new Date(Date.UTC(1899, 11, 30, Math.floor(totalMin / 60), totalMin % 60)));
  }
  cells.push(new Date(Date.UTC(1899, 11, 31, 0, 0))); // 24:00
  return cells;
}

function dayRow(y: number, m: number, d: number, fill: (j: number) => number | null): SheetRows[number] {
  const row: SheetRows[number] = [new Date(Date.UTC(y, m - 1, d))];
  for (let j = 1; j <= 96; j += 1) row.push(fill(j));
  return row;
}

const flat = (v: number) => () => v;

test("parses the pivot layout into 96 ordered 15-minute intervals per day", () => {
  const rows: SheetRows = [header(), dayRow(2026, 5, 1, flat(60)), dayRow(2026, 5, 2, flat(50))];
  const res = parseLoadProfile(rows, { timeZone: TZ });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.intervals.length, 192);
  assert.equal(res.intervals[0]!.loadKwh, 60);
  // First interval of 2026-05-01 starts 00:00 Sofia == 21:00Z on 2026-04-30 (UTC+3 in May).
  assert.equal(res.intervals[0]!.intervalStartUtc.toISOString(), "2026-04-30T21:00:00.000Z");
  assert.equal(res.intervals[0]!.localLabel, "2026-05-01 00:00");
  // Interval ending 09:15 == starting 09:00.
  const nine = res.intervals.find((iv) => iv.localLabel === "2026-05-01 09:00");
  assert.ok(nine);
  assert.equal(nine.loadKwh, 60);
  assert.deepEqual(res.days, ["2026-05-01", "2026-05-02"]);
});

test("scenario 17 — kW average input is converted to kWh per interval (×0.25)", () => {
  const rows: SheetRows = [header(), dayRow(2026, 5, 1, flat(240))];
  const kwh = parseLoadProfile(rows, { timeZone: TZ, unitMode: "kwh_interval" });
  const kw = parseLoadProfile(rows, { timeZone: TZ, unitMode: "kw_average" });
  assert.equal(kwh.ok && kwh.intervals[0]!.loadKwh, 240);
  assert.equal(kw.ok && kw.intervals[0]!.loadKwh, 60); // 240 kW × 0.25 h
});

test("blank cells become missing intervals (loadKwh null), never 0, and are reported", () => {
  const rows: SheetRows = [
    header(),
    dayRow(2026, 5, 1, (j) => (j === 5 || j === 6 ? null : 40)),
  ];
  const res = parseLoadProfile(rows, { timeZone: TZ });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.counts.blankCells, 2);
  const nulls = res.intervals.filter((iv) => iv.loadKwh === null);
  assert.equal(nulls.length, 2);
  assert.ok(res.warnings.some((w) => w.code === "missing_intervals"));
});

test("every value blank is a fatal error", () => {
  const rows: SheetRows = [header(), dayRow(2026, 5, 1, () => null)];
  const res = parseLoadProfile(rows, { timeZone: TZ });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.errors.join(" "), /blank/i);
});

test("a negative value is a fatal error", () => {
  const rows: SheetRows = [header(), dayRow(2026, 5, 1, (j) => (j === 10 ? -5 : 40))];
  const res = parseLoadProfile(rows, { timeZone: TZ });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.errors.join(" "), /negative/i);
});

test("a non-numeric value cell is a fatal error", () => {
  const rows: SheetRows = [header(), dayRow(2026, 5, 1, flat(40))];
  (rows[1] as unknown[])[12] = "n/a";
  const res = parseLoadProfile(rows, { timeZone: TZ });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.errors.join(" "), /not a number/i);
});

test("a data row whose first cell is not a date is a fatal error", () => {
  const rows: SheetRows = [header(), dayRow(2026, 5, 1, flat(40))];
  (rows[1] as unknown[])[0] = "May 1st";
  const res = parseLoadProfile(rows, { timeZone: TZ });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.errors.join(" "), /not a valid date/i);
});

test("wrong column count is a fatal error", () => {
  const rows: SheetRows = [header(), [new Date(Date.UTC(2026, 4, 1)), 1, 2, 3]];
  const res = parseLoadProfile(rows, { timeZone: TZ });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.errors.join(" "), /value columns/i);
});

test("scenario 7 — a duplicate calendar date: the later row wins, both are reported", () => {
  const rows: SheetRows = [
    header(),
    dayRow(2026, 5, 1, flat(10)),
    dayRow(2026, 5, 1, flat(99)),
    dayRow(2026, 5, 2, flat(20)),
  ];
  const res = parseLoadProfile(rows, { timeZone: TZ });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.counts.duplicateDates, 1);
  assert.ok(res.warnings.some((w) => w.code === "duplicate_date"));
  // 2026-05-01 intervals should all carry the later value (99), not 10.
  const may1 = res.intervals.filter((iv) => iv.localLabel.startsWith("2026-05-01"));
  assert.equal(may1.length, 96);
  assert.ok(may1.every((iv) => iv.loadKwh === 99));
  assert.equal(res.intervals.length, 192);
});

test("date gaps (missing days) are reported but not fatal", () => {
  const rows: SheetRows = [
    header(),
    dayRow(2026, 5, 1, flat(10)),
    dayRow(2026, 5, 4, flat(20)), // 2 and 3 May missing
  ];
  const res = parseLoadProfile(rows, { timeZone: TZ });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.counts.dateGaps, 2);
  assert.ok(res.warnings.some((w) => w.code === "date_gap"));
});

test("scenario 8 — spring-forward day: the non-existent local hour collides and is flagged, not silently duplicated", () => {
  // Europe/Sofia springs forward on 2026-03-29 at 03:00 -> 04:00; 03:00–03:59 local does not exist.
  const rows: SheetRows = [header(), dayRow(2026, 3, 29, flat(30))];
  const res = parseLoadProfile(rows, { timeZone: TZ });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  // The 4 non-existent 03:xx slots collapse onto real instants -> flagged & excluded.
  assert.ok(res.counts.dstAmbiguous >= 1, `expected a DST collision, got ${res.counts.dstAmbiguous}`);
  assert.ok(res.warnings.some((w) => w.code === "dst_ambiguous"));
  // No two intervals share the same UTC instant.
  const instants = res.intervals.map((iv) => iv.intervalStartUtc.getTime());
  assert.equal(new Set(instants).size, instants.length);
  // Intervals stay strictly ascending.
  for (let i = 1; i < instants.length; i += 1) assert.ok(instants[i]! > instants[i - 1]!);
});

test("scenario 9 — leap year: Feb 29 is parsed as a normal day", () => {
  const rows: SheetRows = [header(), dayRow(2028, 2, 29, flat(45))];
  const res = parseLoadProfile(rows, { timeZone: TZ });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.intervals.length, 96);
  assert.equal(res.days[0], "2028-02-29");
});

test("a suspiciously power-shaped profile warns when declared as kWh", () => {
  const rows: SheetRows = [header(), dayRow(2026, 5, 1, flat(400))]; // 400 kWh/15min => 1.6 MW average
  const res = parseLoadProfile(rows, { timeZone: TZ, unitMode: "kwh_interval" });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.ok(res.warnings.some((w) => w.code === "possible_kw_input"));
});
