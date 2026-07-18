/**
 * ENTSO-E Transparency Platform provider — day-ahead electricity prices.
 *
 * This module owns everything specific to ENTSO-E: authentication (the
 * `securityToken` query parameter), the HTTP request shape, and parsing
 * and validating its XML response format. It must never contain
 * Huawei/FusionSolar logic or automation/decision logic — its only job is
 * turning an ENTSO-E API response into validated, normalized price points.
 *
 * Nothing in the Dashboard, Settings page, or Decision Engine calls this
 * module directly — only `lib/market-price/refresh-market-prices.ts` (the
 * scheduler) does. Everything else reads persisted prices through
 * `lib/market-price/provider.ts`.
 *
 * Reference: ENTSO-E Transparency Platform restful API user guide,
 * document type A44 ("Price Document" / day-ahead prices).
 *
 * Curve type A03 ("sequential fixed size block, repeat previous value"):
 * ENTSO-E's day-ahead price documents for this zone use `curveType`
 * A03, whose documented encoding OMITS a `Point` whenever its price
 * equals the immediately preceding interval's price — the consumer is
 * expected to carry the previous value forward for the omitted position.
 * This was confirmed empirically against a real reference (a third-party
 * Bulgarian price listing for 2026-07-18): positions 86-87 (19:15Z,
 * 19:30Z) were not transmitted in the XML, both because they equal
 * position 85's price (145), and the reference listing shows exactly
 * 145.00 for both. Decoding this correctly (the forward-fill loop inside
 * `parseEntsoeDayAheadPricesXml` below) is required — an earlier version
 * of this module treated these omissions as missing data, which was
 * wrong. This is decoding the wire format's own documented convention,
 * not fabricating or interpolating a value Voltessa invented.
 *
 * Validation policy (deliberately not "reject on any imperfection" — see
 * the milestone discussion this was built against): after A03 decoding,
 * a position can still be genuinely absent (no prior value in the period
 * to carry forward, or a non-A03 curve type). Bulgaria's real ENTSO-E
 * feed has, on rare occasions, had such genuine gaps. Rejecting outright
 * on any gap would make the dashboard show "unavailable" more often than
 * reality warrants, so:
 *
 * - Invalid XML, wrong bidding zone, wrong currency, wrong price unit,
 *   inconsistent resolution, duplicate timestamps, or timestamps outside
 *   the requested period are always hard rejections (`EntsoeApiError`) —
 *   these indicate a response that doesn't match what was asked for, not
 *   an expected data-quality wrinkle.
 * - Genuinely missing intervals (after A03 decoding) are tolerated up to
 *   `MAX_MISSING_RATIO` (5%): the available intervals are returned, the
 *   missing ones are listed explicitly (never fabricated or
 *   interpolated), and the series is flagged `isPartial`. Above that
 *   ratio, the whole dataset is rejected.
 */

import { XMLParser, XMLValidator } from "fast-xml-parser";

const ENTSOE_API_BASE_URL = "https://web-api.tp.entsoe.eu/api";
const DAY_AHEAD_PRICES_DOCUMENT_TYPE = "A44";
const EXPECTED_CURRENCY = "EUR";
const EXPECTED_PRICE_UNIT = "MWH";
const MAX_MISSING_RATIO = 0.05;
/** Curve type whose omitted positions must be forward-filled — see module doc comment. */
const REPEAT_PREVIOUS_VALUE_CURVE_TYPE = "A03";

export class EntsoeApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EntsoeApiError";
  }
}

export type EntsoeDayAheadPricePoint = {
  timestamp: Date;
  price: number;
  currency: string;
};

export type EntsoeDayAheadPriceSeries = {
  points: EntsoeDayAheadPricePoint[];
  resolutionMinutes: number;
  expectedIntervals: number;
  missingTimestamps: Date[];
  isPartial: boolean;
};

function formatEntsoeTimestamp(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, "0");

  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`
  );
}

function parseIsoDurationMinutes(resolution: unknown): number {
  const match = /^PT(\d+)M$/.exec(String(resolution ?? ""));

  if (!match) {
    throw new EntsoeApiError(
      `Unsupported ENTSO-E resolution: ${JSON.stringify(resolution)}`,
    );
  }

  return Number(match[1]);
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

/** fast-xml-parser represents `<el attr="x">text</el>` as `{ "@_attr": "x", "#text": "text" }`. */
function textValue(node: unknown): string {
  if (
    node !== null &&
    typeof node === "object" &&
    "#text" in (node as Record<string, unknown>)
  ) {
    return String((node as Record<string, unknown>)["#text"]);
  }

  return String(node ?? "");
}

/**
 * Parses and validates an ENTSO-E `Publication_MarketDocument` (day-ahead
 * prices, document type A44) XML body for a single requested bidding zone
 * and period. See the module doc comment for the exact validation policy.
 */
export function parseEntsoeDayAheadPricesXml(
  xml: string,
  params: { biddingZone: string; periodStart: Date; periodEnd: Date },
): EntsoeDayAheadPriceSeries {
  const validation = XMLValidator.validate(xml);

  if (validation !== true) {
    throw new EntsoeApiError(
      `Invalid ENTSO-E XML response: ${validation.err.msg}`,
    );
  }

  const parser = new XMLParser({ ignoreAttributes: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed: any = parser.parse(xml);

  if (parsed.Acknowledgement_MarketDocument) {
    const reasonText =
      parsed.Acknowledgement_MarketDocument.Reason?.text ??
      "Unknown ENTSO-E error";

    throw new EntsoeApiError(`ENTSO-E returned an error: ${reasonText}`);
  }

  const document = parsed.Publication_MarketDocument;

  if (!document) {
    throw new EntsoeApiError(
      "Invalid ENTSO-E XML response: no Publication_MarketDocument found",
    );
  }

  const points: EntsoeDayAheadPricePoint[] = [];
  let resolutionMinutes: number | null = null;

  for (const timeSeries of asArray(document.TimeSeries)) {
    const inDomain = textValue(timeSeries["in_Domain.mRID"]);
    const outDomain = textValue(timeSeries["out_Domain.mRID"]);

    if (inDomain !== params.biddingZone || outDomain !== params.biddingZone) {
      throw new EntsoeApiError(
        `ENTSO-E response bidding zone mismatch: requested ${params.biddingZone}, got in=${inDomain} out=${outDomain}`,
      );
    }

    // Note: ENTSO-E's XML tag names are themselves dotted
    // ("<currency_Unit.name>EUR</currency_Unit.name>"), not nested
    // elements — fast-xml-parser therefore produces a single flat key
    // literally named "currency_Unit.name", not a `currency_Unit: { name }`
    // object. Bracket access (not `.currency_Unit?.name`) is required.
    const currency = textValue(timeSeries["currency_Unit.name"]);

    if (currency !== EXPECTED_CURRENCY) {
      throw new EntsoeApiError(`Unexpected ENTSO-E currency: ${currency}`);
    }

    const priceUnit = textValue(timeSeries["price_Measure_Unit.name"]);

    if (priceUnit !== EXPECTED_PRICE_UNIT) {
      throw new EntsoeApiError(`Unexpected ENTSO-E price unit: ${priceUnit}`);
    }

    const curveType = textValue(timeSeries.curveType);
    const forwardFillsOmittedValues =
      curveType === REPEAT_PREVIOUS_VALUE_CURVE_TYPE;

    for (const period of asArray(timeSeries.Period)) {
      const intervalStart = new Date(period.timeInterval.start);
      const intervalEnd = new Date(period.timeInterval.end);
      const thisResolution = parseIsoDurationMinutes(period.resolution);

      if (resolutionMinutes === null) {
        resolutionMinutes = thisResolution;
      } else if (resolutionMinutes !== thisResolution) {
        throw new EntsoeApiError(
          `Inconsistent ENTSO-E resolution across periods: ${resolutionMinutes}M vs ${thisResolution}M`,
        );
      }

      const transmittedByPosition = new Map<number, number>();

      for (const point of asArray(period.Point)) {
        const position = Number(point.position);
        const price = Number(point["price.amount"]);

        if (!Number.isFinite(position) || !Number.isFinite(price)) {
          throw new EntsoeApiError(
            `Malformed ENTSO-E point: position=${point.position} price.amount=${point["price.amount"]}`,
          );
        }

        transmittedByPosition.set(position, price);
      }

      const periodPositions = Math.round(
        (intervalEnd.getTime() - intervalStart.getTime()) /
          (thisResolution * 60 * 1000),
      );

      let lastKnownPrice: number | null = null;

      for (let position = 1; position <= periodPositions; position += 1) {
        const timestamp = new Date(
          intervalStart.getTime() + (position - 1) * thisResolution * 60 * 1000,
        );

        if (transmittedByPosition.has(position)) {
          const price = transmittedByPosition.get(position) as number;

          points.push({ timestamp, price, currency });
          lastKnownPrice = price;
        } else if (forwardFillsOmittedValues && lastKnownPrice !== null) {
          // Decoding ENTSO-E's own A03 "repeat previous value" encoding —
          // see module doc comment. Not an interpolation Voltessa invents.
          points.push({ timestamp, price: lastKnownPrice, currency });
        }
        // Otherwise: genuinely absent for this position. Left out of
        // `points` entirely; picked up by the missing-interval check below.
      }
    }
  }

  if (points.length === 0 || resolutionMinutes === null) {
    throw new EntsoeApiError("ENTSO-E response contained no price points");
  }

  const byTimestamp = new Map<number, EntsoeDayAheadPricePoint>();

  for (const point of points) {
    const key = point.timestamp.getTime();

    if (byTimestamp.has(key)) {
      throw new EntsoeApiError(
        `Duplicate ENTSO-E price point for timestamp ${point.timestamp.toISOString()}`,
      );
    }

    byTimestamp.set(key, point);
  }

  for (const point of points) {
    if (
      point.timestamp < params.periodStart ||
      point.timestamp >= params.periodEnd
    ) {
      throw new EntsoeApiError(
        `ENTSO-E price point ${point.timestamp.toISOString()} falls outside the requested period [${params.periodStart.toISOString()}, ${params.periodEnd.toISOString()})`,
      );
    }
  }

  const expectedTimestamps: number[] = [];

  for (
    let t = params.periodStart.getTime();
    t < params.periodEnd.getTime();
    t += resolutionMinutes * 60 * 1000
  ) {
    expectedTimestamps.push(t);
  }

  const missingTimestamps = expectedTimestamps
    .filter((t) => !byTimestamp.has(t))
    .map((t) => new Date(t));

  const missingRatio = missingTimestamps.length / expectedTimestamps.length;

  if (missingRatio > MAX_MISSING_RATIO) {
    throw new EntsoeApiError(
      `ENTSO-E dataset too incomplete: ${missingTimestamps.length}/${expectedTimestamps.length} ` +
        `intervals missing (${(missingRatio * 100).toFixed(1)}%, exceeds ${(MAX_MISSING_RATIO * 100).toFixed(0)}% threshold)`,
    );
  }

  return {
    points: [...points].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    ),
    resolutionMinutes,
    expectedIntervals: expectedTimestamps.length,
    missingTimestamps,
    isPartial: missingTimestamps.length > 0,
  };
}

/**
 * Fetches day-ahead prices for a single bidding zone and period from the
 * real ENTSO-E API. Requires `ENTSOE_API_TOKEN` to be configured — throws
 * `EntsoeApiError` if it is missing rather than silently returning empty
 * data, so callers cannot mistake "not configured" for "no prices today."
 */
export async function fetchEntsoeDayAheadPrices(params: {
  biddingZone: string;
  periodStart: Date;
  periodEnd: Date;
}): Promise<EntsoeDayAheadPriceSeries> {
  const token = process.env.ENTSOE_API_TOKEN;

  if (!token) {
    throw new EntsoeApiError("ENTSOE_API_TOKEN is not configured");
  }

  const url = new URL(ENTSOE_API_BASE_URL);

  url.searchParams.set("securityToken", token);
  url.searchParams.set("documentType", DAY_AHEAD_PRICES_DOCUMENT_TYPE);
  url.searchParams.set("in_Domain", params.biddingZone);
  url.searchParams.set("out_Domain", params.biddingZone);
  url.searchParams.set(
    "periodStart",
    formatEntsoeTimestamp(params.periodStart),
  );
  url.searchParams.set("periodEnd", formatEntsoeTimestamp(params.periodEnd));

  const response = await fetch(url.toString());
  const body = await response.text();

  if (!response.ok) {
    throw new EntsoeApiError(
      `ENTSO-E API request failed with status ${response.status}: ${body.slice(0, 500)}`,
    );
  }

  return parseEntsoeDayAheadPricesXml(body, params);
}
