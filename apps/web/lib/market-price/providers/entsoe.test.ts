import assert from "node:assert/strict";
import { test } from "node:test";

import { parseEntsoeDayAheadPricesXml } from "./entsoe";

const BIDDING_ZONE = "10YCA-BULGARIA-R";
const PERIOD_START = new Date("2026-01-01T00:00:00Z");
const PERIOD_END = new Date("2026-01-01T00:30:00Z");

type PointFixture = { position: number; price: number };

function timeSeriesXml(points: PointFixture[]): string {
  const pointsXml = points
    .map(
      (point) =>
        `<Point><position>${point.position}</position><price.amount>${point.price}</price.amount></Point>`,
    )
    .join("");

  return (
    `<TimeSeries>` +
    `<in_Domain.mRID>${BIDDING_ZONE}</in_Domain.mRID>` +
    `<out_Domain.mRID>${BIDDING_ZONE}</out_Domain.mRID>` +
    `<currency_Unit.name>EUR</currency_Unit.name>` +
    `<price_Measure_Unit.name>MWH</price_Measure_Unit.name>` +
    `<curveType>A01</curveType>` +
    `<Period>` +
    `<timeInterval><start>2026-01-01T00:00Z</start><end>2026-01-01T00:30Z</end></timeInterval>` +
    `<resolution>PT15M</resolution>` +
    `${pointsXml}` +
    `</Period>` +
    `</TimeSeries>`
  );
}

function documentXml(timeSeriesList: PointFixture[][]): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<Publication_MarketDocument xmlns="urn:iec62325.351:tc57wg16:451-3:publicationdocument:7:3">` +
    `${timeSeriesList.map(timeSeriesXml).join("")}` +
    `</Publication_MarketDocument>`
  );
}

function parse(timeSeriesList: PointFixture[][]) {
  return parseEntsoeDayAheadPricesXml(documentXml(timeSeriesList), {
    biddingZone: BIDDING_ZONE,
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
  });
}

test("normal single-TimeSeries response is unchanged", () => {
  const result = parse([
    [
      { position: 1, price: 100 },
      { position: 2, price: 110 },
    ],
  ]);

  assert.equal(result.points.length, 2);
  assert.equal(result.points[0]?.price, 100);
  assert.equal(result.points[1]?.price, 110);
  assert.equal(result.isPartial, false);
  assert.equal(result.missingTimestamps.length, 0);
});

test("duplicate timestamp with identical prices across TimeSeries resolves to a single price", () => {
  const result = parse([
    [
      { position: 1, price: 100 },
      { position: 2, price: 110 },
    ],
    [
      { position: 1, price: 100 },
      { position: 2, price: 110 },
    ],
  ]);

  assert.equal(result.points.length, 2);
  assert.equal(result.points[0]?.price, 100);
  assert.equal(result.points[1]?.price, 110);
  assert.equal(result.isPartial, false);
});

test("duplicate timestamp with conflicting prices resolves to the lowest price", () => {
  const result = parse([
    [
      { position: 1, price: 100 },
      { position: 2, price: 110 },
    ],
    [
      { position: 1, price: 80 },
      { position: 2, price: 110 },
    ],
  ]);

  assert.equal(result.points.length, 2);
  assert.equal(result.points[0]?.price, 80);
  assert.equal(result.points[1]?.price, 110);
  assert.equal(result.isPartial, false);
});
