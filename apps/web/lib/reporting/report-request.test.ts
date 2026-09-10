import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_REPORT_RANGE_DAYS, parseReportRequest } from "./report-request";

const TZ = "Europe/Sofia";

const validBase = {
  plantId: "plant_1",
  start: "2026-09-01T00:00",
  end: "2026-09-08T00:00",
  metrics: ["revenue", "pvProduction", "price"],
  format: "csv" as const,
};

test("a valid request parses, orders metrics canonically, and reports the interval count", () => {
  const result = parseReportRequest(validBase, TZ);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  // canonical order is pvProduction < price < revenue
  assert.deepEqual(result.value.metrics, ["pvProduction", "price", "revenue"]);
  assert.equal(result.value.format, "csv");
  // 7 days, no DST transition in this window -> 7 * 96 intervals
  assert.equal(result.value.intervalCount, 7 * 96);
  assert.equal(result.value.startUtc.toISOString(), "2026-08-31T21:00:00.000Z");
  assert.equal(result.value.endUtc.toISOString(), "2026-09-07T21:00:00.000Z");
});

test("start/end wall-clock is snapped to the 15-minute grid (start floored, end ceiled)", () => {
  const result = parseReportRequest(
    { ...validBase, start: "2026-09-01T08:07", end: "2026-09-01T09:08" },
    TZ,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Sofia is UTC+3 in September (EEST): 08:07 -> 08:00 local -> 05:00Z
  assert.equal(result.value.startUtc.toISOString(), "2026-09-01T05:00:00.000Z");
  // 09:08 -> ceil to 09:15 local -> 06:15Z
  assert.equal(result.value.endUtc.toISOString(), "2026-09-01T06:15:00.000Z");
  assert.equal(result.value.intervalCount, 5);
});

test("rejects a start that is not before the end", () => {
  const result = parseReportRequest(
    { ...validBase, start: "2026-09-08T00:00", end: "2026-09-01T00:00" },
    TZ,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /start must be before the end/i);
});

test("rejects an equal start and end", () => {
  const result = parseReportRequest(
    { ...validBase, start: "2026-09-01T00:00", end: "2026-09-01T00:00" },
    TZ,
  );
  assert.equal(result.ok, false);
});

test("rejects a malformed datetime string", () => {
  for (const bad of ["2026-09-01", "01/09/2026 00:00", "2026-09-01T24:00", "", "not-a-date"]) {
    const result = parseReportRequest({ ...validBase, start: bad }, TZ);
    assert.equal(result.ok, false, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

test("rejects a calendar date that does not exist", () => {
  const result = parseReportRequest(
    { ...validBase, start: "2026-02-30T00:00", end: "2026-03-02T00:00" },
    TZ,
  );
  assert.equal(result.ok, false);
});

test("rejects an unknown metric value", () => {
  const result = parseReportRequest({ ...validBase, metrics: ["pvProduction", "co2"] }, TZ);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /not recognised/i);
});

test("rejects an empty metric selection", () => {
  const result = parseReportRequest({ ...validBase, metrics: [] }, TZ);
  assert.equal(result.ok, false);
});

test("rejects a non-array metric selection", () => {
  const result = parseReportRequest({ ...validBase, metrics: "pvProduction" as unknown }, TZ);
  assert.equal(result.ok, false);
});

test("rejects an unknown export format", () => {
  const result = parseReportRequest({ ...validBase, format: "pdf" as unknown }, TZ);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /csv or xlsx/i);
});

test("rejects a missing plant id", () => {
  const result = parseReportRequest({ ...validBase, plantId: "  " }, TZ);
  assert.equal(result.ok, false);
});

test(`rejects a range longer than ${MAX_REPORT_RANGE_DAYS} days`, () => {
  const result = parseReportRequest(
    { ...validBase, start: "2026-01-01T00:00", end: "2026-05-01T00:00" },
    TZ,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, new RegExp(`${MAX_REPORT_RANGE_DAYS} days`));
});

test("accepts a range exactly at the limit", () => {
  // 2026-06-01 .. 2026-09-01 is 92 days -> within 93
  const result = parseReportRequest(
    { ...validBase, start: "2026-06-01T00:00", end: "2026-09-01T00:00" },
    TZ,
  );
  assert.equal(result.ok, true);
});

test("DST spring-forward day is 23 hours -> 92 intervals, none duplicated or lost", () => {
  // Europe/Sofia switches EET->EEST on 2026-03-29 at 03:00 local.
  const result = parseReportRequest(
    { ...validBase, start: "2026-03-29T00:00", end: "2026-03-30T00:00" },
    TZ,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.intervalCount, 92);
  assert.equal(result.value.startUtc.toISOString(), "2026-03-28T22:00:00.000Z");
  assert.equal(result.value.endUtc.toISOString(), "2026-03-29T21:00:00.000Z");
});

test("DST fall-back day is 25 hours -> 100 intervals, none duplicated or lost", () => {
  // Europe/Sofia switches EEST->EET on 2026-10-25 at 04:00 local.
  const result = parseReportRequest(
    { ...validBase, start: "2026-10-25T00:00", end: "2026-10-26T00:00" },
    TZ,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.intervalCount, 100);
});
