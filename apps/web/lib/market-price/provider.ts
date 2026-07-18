/**
 * Market Price Provider — the abstraction the Dashboard, Settings page,
 * and Decision Engine (`lib/automation/export-decision.ts`) all depend on.
 * None of them may read ENTSO-E, or any other market data source, directly
 * — they go through this interface only.
 *
 * This provider itself never calls ENTSO-E. It only reads prices that the
 * scheduler (`lib/market-price/refresh-market-prices.ts`) has already
 * persisted via `lib/market-price/providers/entsoe.ts`. If no persisted
 * data is available it returns an explicit unavailable result — it never
 * fabricates a price.
 *
 * Deliberately not designed around a single "current price" function:
 * day-ahead prices are exposed as their own operation (this is exactly the
 * shape of data ENTSO-E's day-ahead auction — and therefore the scheduler
 * — provides). Intraday prices are a genuine placeholder: ENTSO-E's
 * intraday continuous-trading data is a different document type/endpoint
 * and implementing it is explicit future work, not done here.
 */

import { Prisma } from "@prisma/client";

import { DEFAULT_BIDDING_ZONE } from "@/lib/market-price/constants";
import {
  ENTSOE_MARKET_TIMEZONE,
  localDayBoundsUtc,
} from "@/lib/market-price/timezone";
import { prisma } from "@/lib/prisma";

export type MarketPrice = {
  price: number;
  currency: string;
  unit: "MWh";
  timestamp: Date;
  biddingZone: string;
  source: string;
};

export type MarketPriceResult =
  | { available: true; price: MarketPrice }
  | { available: false; reason: string };

export type MarketPriceSeriesResult =
  | { available: true; prices: MarketPrice[] }
  | { available: false; reason: string };

export type MarketPriceImportStatus =
  | {
      available: true;
      isPartial: boolean;
      expectedIntervals: number;
      importedIntervals: number;
      missingIntervalsCount: number;
      importedAt: Date;
    }
  | { available: false; reason: string };

export type MarketPriceProvider = {
  getCurrentPrice: () => Promise<MarketPriceResult>;
  getDayAheadPrices: () => Promise<MarketPriceSeriesResult>;
  /** Placeholder — see module doc comment. Always returns `available: false`. */
  getIntradayPrices: () => Promise<MarketPriceSeriesResult>;
  /** Status of the most recent import run — surfaces partial imports to the application. */
  getLatestImportStatus: () => Promise<MarketPriceImportStatus>;
};

type PersistedMarketPriceRow = {
  price: Prisma.Decimal;
  currency: string;
  timestamp: Date;
  biddingZone: string;
  source: string;
};

function toMarketPrice(row: PersistedMarketPriceRow): MarketPrice {
  return {
    price: Number(row.price.toString()),
    currency: row.currency,
    unit: "MWh",
    timestamp: row.timestamp,
    biddingZone: row.biddingZone,
    source: row.source,
  };
}

/**
 * Reads persisted market prices from the database. This is the concrete
 * implementation the Dashboard, Settings page, and Decision Engine use —
 * there is no mock provider anymore; when no data has been persisted yet
 * (for example before the scheduler's first successful run), callers get
 * an explicit `available: false` result instead of a fabricated price.
 */
export const dbMarketPriceProvider: MarketPriceProvider = {
  async getCurrentPrice(): Promise<MarketPriceResult> {
    const row = await prisma.marketPrice.findFirst({
      where: {
        biddingZone: DEFAULT_BIDDING_ZONE,
        timestamp: { lte: new Date() },
      },
      orderBy: { timestamp: "desc" },
    });

    if (!row) {
      return { available: false, reason: "no_persisted_price_data" };
    }

    return { available: true, price: toMarketPrice(row) };
  },

  async getDayAheadPrices(): Promise<MarketPriceSeriesResult> {
    // Must use the same CET/CEST market-day boundary the importer persists
    // against (see lib/market-price/timezone.ts) — a naive UTC calendar day
    // would miss the early hours of "today" (which the importer stores
    // under the previous UTC calendar date) and include hours that belong
    // to a different market day.
    const { start: startOfDay, end: endOfDay } = localDayBoundsUtc(
      new Date(),
      ENTSOE_MARKET_TIMEZONE,
    );

    const rows = await prisma.marketPrice.findMany({
      where: {
        biddingZone: DEFAULT_BIDDING_ZONE,
        timestamp: { gte: startOfDay, lt: endOfDay },
      },
      orderBy: { timestamp: "asc" },
    });

    if (rows.length === 0) {
      return {
        available: false,
        reason: "no_persisted_price_data_for_today",
      };
    }

    return { available: true, prices: rows.map(toMarketPrice) };
  },

  async getIntradayPrices(): Promise<MarketPriceSeriesResult> {
    return { available: false, reason: "intraday_prices_not_implemented" };
  },

  async getLatestImportStatus(): Promise<MarketPriceImportStatus> {
    const row = await prisma.marketPriceImport.findFirst({
      where: { biddingZone: DEFAULT_BIDDING_ZONE },
      orderBy: { importedAt: "desc" },
    });

    if (!row) {
      return { available: false, reason: "no_import_has_run_yet" };
    }

    return {
      available: true,
      isPartial: row.isPartial,
      expectedIntervals: row.expectedIntervals,
      importedIntervals: row.importedIntervals,
      missingIntervalsCount: row.missingTimestamps.length,
      importedAt: row.importedAt,
    };
  },
};
