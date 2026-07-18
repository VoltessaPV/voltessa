/**
 * ENTSO-E Transparency Platform provider — day-ahead electricity prices.
 *
 * This module owns everything specific to ENTSO-E: authentication (the
 * `securityToken` query parameter), the HTTP request shape, and parsing its
 * XML response format. It must never contain Huawei/FusionSolar logic or
 * automation/decision logic — its only job is turning an ENTSO-E API
 * response into plain, normalized price points
 * (`EntsoeDayAheadPricePoint[]`).
 *
 * Nothing in the Dashboard, Settings page, or Decision Engine calls this
 * module directly — only `lib/market-price/refresh-market-prices.ts` (the
 * scheduler) does. Everything else reads persisted prices through
 * `lib/market-price/provider.ts`.
 *
 * Reference: ENTSO-E Transparency Platform restful API user guide,
 * document type A44 ("Price Document" / day-ahead prices).
 */

import { XMLParser } from "fast-xml-parser";

const ENTSOE_API_BASE_URL = "https://web-api.tp.entsoe.eu/api";
const DAY_AHEAD_PRICES_DOCUMENT_TYPE = "A44";

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

/**
 * Parses an ENTSO-E `Publication_MarketDocument` (day-ahead prices) XML
 * body into normalized price points. Exported separately from the fetch
 * function so it can be exercised directly against a sample response
 * without needing a live API token.
 */
export function parseEntsoeDayAheadPricesXml(
  xml: string,
): EntsoeDayAheadPricePoint[] {
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
      "Unexpected ENTSO-E response: no Publication_MarketDocument found",
    );
  }

  const points: EntsoeDayAheadPricePoint[] = [];

  for (const timeSeries of asArray(document.TimeSeries)) {
    const currency = timeSeries.currency_Unit?.name ?? "EUR";

    for (const period of asArray(timeSeries.Period)) {
      const intervalStart = new Date(period.timeInterval.start);
      const resolutionMinutes = parseIsoDurationMinutes(period.resolution);

      for (const point of asArray(period.Point)) {
        const position = Number(point.position);
        const price = Number(point["price.amount"]);

        if (!Number.isFinite(position) || !Number.isFinite(price)) {
          continue;
        }

        points.push({
          timestamp: new Date(
            intervalStart.getTime() +
              (position - 1) * resolutionMinutes * 60 * 1000,
          ),
          price,
          currency,
        });
      }
    }
  }

  return points;
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
}): Promise<EntsoeDayAheadPricePoint[]> {
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

  return parseEntsoeDayAheadPricesXml(body);
}
