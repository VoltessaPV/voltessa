import assert from "node:assert/strict";
import { test } from "node:test";

import { fetchIbexDayAheadPrices, IbexApiError, IbexNoDataAvailableError } from "./ibex";

type MockDataResponse = { status: number; body: unknown };

/**
 * Mocks the 3-step IBEX handshake (bot-check page -> CSRF token -> data)
 * discovered during the read-only feasibility investigation. Only the
 * final `get_data` response varies per test; the first two steps are
 * always the same shape a real browser sees. No real cookies/secrets -
 * these are synthetic placeholder values, not anything captured from a
 * live session.
 */
function withMockedIbex<T>(dataResponse: MockDataResponse, run: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;

  // @ts-expect-error - test-only stand-in for the global fetch IBEX's provider uses.
  globalThis.fetch = async (input: string | URL) => {
    const url = input.toString();

    if (url.includes("action=get_csrf_token")) {
      return new Response(JSON.stringify({ csrf_token: "test-csrf-token" }), {
        status: 200,
        headers: { "set-cookie": "PHPSESSID=test-session; Path=/" },
      });
    }

    if (url.includes("action=get_data")) {
      return new Response(JSON.stringify(dataResponse.body), { status: dataResponse.status });
    }

    // The initial HTML page load (bot-check cookie mint).
    return new Response(
      `<script>document.cookie = "js_ok_v2=test-bot-check-value;path=/;max-age=86400;samesite=lax;secure";</script>`,
      { status: 200 },
    );
  };

  return run().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

/** Generates a synthetic but structurally realistic 96-QH day (deterministic, arbitrary prices). */
function generate96IntervalDay(date: string): unknown {
  const main_data = [];

  for (let i = 0; i < 96; i += 1) {
    const startMinutes = i * 15;
    const startH = String(Math.floor(startMinutes / 60)).padStart(2, "0");
    const startM = String(startMinutes % 60).padStart(2, "0");
    const endMinutes = startMinutes + 15;
    const endH = String(Math.floor(endMinutes / 60) % 24).padStart(2, "0");
    const endM = String(endMinutes % 60).padStart(2, "0");

    main_data.push({
      product: `QH ${i + 1}`,
      delivery_period: `${startH}:${startM} - ${endH}:${endM}`,
      price: (100 + i).toFixed(2),
      volume: "1000.0",
    });
  }

  // Embed the one real, production-verified anchor point from the
  // feasibility investigation: IBEX "23:00 - 23:15" on 2026-08-31 = 226.94
  // EUR/MWh, which matched Voltessa's own stored ENTSO-E price at real UTC
  // instant 2026-08-31T21:00:00Z (Bulgaria-local 2026-09-01 00:00) exactly.
  if (date === "2026-08-31") {
    main_data[92] = { product: "QH 93", delivery_period: "23:00 - 23:15", price: "226.94", volume: "3012.1" };
  }

  return { main_data, is_hourly_data: false, currency: "EUR", date, language: "en" };
}

test("8. IBEX timestamp conversion: CET wall-clock label -> canonical UTC instant (the proven +1h-vs-Bulgaria convention)", async () => {
  const periodStart = new Date("2026-08-30T22:00:00Z"); // CET 2026-08-31 00:00
  const periodEnd = new Date("2026-08-31T22:00:00Z");

  const series = await withMockedIbex({ status: 200, body: generate96IntervalDay("2026-08-31") }, () =>
    fetchIbexDayAheadPrices({ periodStart, periodEnd }),
  );

  const anchor = series.points.find((p) => p.timestamp.toISOString() === "2026-08-31T21:00:00.000Z");

  assert.ok(anchor, "expected the 23:00 CET point to convert to 2026-08-31T21:00:00Z");
  assert.equal(anchor!.price, 226.94);
});

test("9. full 2026-08-31 fixture maps exactly to 96 canonical intervals with no gaps or contamination", async () => {
  const periodStart = new Date("2026-08-30T22:00:00Z");
  const periodEnd = new Date("2026-08-31T22:00:00Z");

  const series = await withMockedIbex({ status: 200, body: generate96IntervalDay("2026-08-31") }, () =>
    fetchIbexDayAheadPrices({ periodStart, periodEnd }),
  );

  assert.equal(series.points.length, 96);
  assert.equal(series.expectedIntervals, 96);
  assert.equal(series.isPartial, false);
  assert.equal(series.points[0]!.timestamp.toISOString(), "2026-08-30T22:00:00.000Z");
  assert.equal(series.points[95]!.timestamp.toISOString(), "2026-08-31T21:45:00.000Z");

  // Strictly increasing, 15-minute spacing, no duplicates, no gaps.
  for (let i = 1; i < series.points.length; i += 1) {
    const deltaMs = series.points[i]!.timestamp.getTime() - series.points[i - 1]!.timestamp.getTime();
    assert.equal(deltaMs, 15 * 60 * 1000);
  }
});

test("13. DST-sensitive delivery day: expected interval count is derived, never hard-coded to 96", async () => {
  // 2026-10-25 is the EU DST fall-back day - the CET calendar day is 25
  // hours long (100 quarter-hour intervals), not 96.
  const periodStart = new Date("2026-10-24T22:00:00Z");
  const periodEnd = new Date("2026-10-25T23:00:00Z"); // 25 hours later

  const main_data = [];
  for (let i = 0; i < 100; i += 1) {
    const startMinutes = i * 15;
    const startH = String(Math.floor(startMinutes / 60) % 24).padStart(2, "0");
    const startM = String(startMinutes % 60).padStart(2, "0");
    main_data.push({
      product: `QH ${i + 1}`,
      delivery_period: `${startH}:${startM} - xx:xx`,
      price: "100.00",
      volume: "1000.0",
    });
  }

  const series = await withMockedIbex(
    { status: 200, body: { main_data, is_hourly_data: false, currency: "EUR", date: "2026-10-25", language: "en" } },
    () => fetchIbexDayAheadPrices({ periodStart, periodEnd }),
  );

  assert.equal(series.expectedIntervals, 100);
  assert.equal(series.points.length, 100);
  assert.equal(series.isPartial, false);
});

test("IBEX 'no data available' is a distinct, non-error condition", async () => {
  const periodStart = new Date("2026-08-30T22:00:00Z");
  const periodEnd = new Date("2026-08-31T22:00:00Z");

  await assert.rejects(
    () =>
      withMockedIbex({ status: 403, body: { error: "No data available" } }, () =>
        fetchIbexDayAheadPrices({ periodStart, periodEnd }),
      ),
    IbexNoDataAvailableError,
  );
});

test("IBEX hourly (non-SDAC) data is rejected, not silently treated as 15-minute data", async () => {
  const periodStart = new Date("2026-08-30T22:00:00Z");
  const periodEnd = new Date("2026-08-31T22:00:00Z");

  await assert.rejects(
    () =>
      withMockedIbex(
        {
          status: 200,
          body: { main_data: [], is_hourly_data: true, currency: "EUR", date: "2026-08-31", language: "en" },
        },
        () => fetchIbexDayAheadPrices({ periodStart, periodEnd }),
      ),
    IbexApiError,
  );
});

test("IBEX wrong currency is rejected", async () => {
  const periodStart = new Date("2026-08-30T22:00:00Z");
  const periodEnd = new Date("2026-08-31T22:00:00Z");

  await assert.rejects(
    () =>
      withMockedIbex(
        {
          status: 200,
          body: { main_data: [{ product: "QH 1", delivery_period: "00:00 - 00:15", price: "100", volume: "1" }], is_hourly_data: false, currency: "BGN", date: "2026-08-31", language: "en" },
        },
        () => fetchIbexDayAheadPrices({ periodStart, periodEnd }),
      ),
    IbexApiError,
  );
});
