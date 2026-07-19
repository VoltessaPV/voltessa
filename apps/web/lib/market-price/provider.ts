/**
 * Market Price Provider — the abstraction the Dashboard, Settings page,
 * Market page, and Decision Engine (`lib/automation/export-decision.ts`)
 * all depend on. None of them may read ENTSO-E, or any other market data
 * source, directly — they go through this interface only.
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
 *
 * Every method accepts an optional `biddingZone` (defaulting to
 * `DEFAULT_BIDDING_ZONE`) and `getCurrentPrice`/`getDayAheadPrices` accept
 * an optional `referenceDate` (defaulting to now). Neither is used by any
 * caller with a non-default value yet - the Market page's country
 * selector and date picker are the reason these exist, so that adding a
 * second country or browsing another day is a matter of passing a
 * different argument, not redesigning this provider.
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
      resolutionMinutes: number;
      importedAt: Date;
    }
  | { available: false; reason: string };

export type MarketPriceProvider = {
  getCurrentPrice: (options?: {
    biddingZone?: string;
    referenceDate?: Date;
  }) => Promise<MarketPriceResult>;
  getDayAheadPrices: (options?: {
    biddingZone?: string;
    referenceDate?: Date;
    /**
     * Local-day timezone the returned prices are windowed to. Defaults to
     * `ENTSOE_MARKET_TIMEZONE` (CET/CEST) — the historical default every
     * existing caller relies on. `MarketPrice.timestamp` rows are real,
     * absolute UTC instants regardless of which CET market day originally
     * fetched them, so windowing by a different zone here (e.g. the
     * Market page passing "Europe/Sofia") is purely a query-boundary
     * choice, never a reinterpretation of stored data.
     */
    timeZone?: string;
  }) => Promise<MarketPriceSeriesResult>;
  /** Placeholder — see module doc comment. Always returns `available: false`. */
  getIntradayPrices: (options?: {
    biddingZone?: string;
  }) => Promise<MarketPriceSeriesResult>;
  /** Status of the most recent import run — surfaces partial imports to the application. */
  getLatestImportStatus: (options?: {
    biddingZone?: string;
  }) => Promise<MarketPriceImportStatus>;
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
 * implementation the Dashboard, Settings page, Market page, and Decision
 * Engine use — there is no mock provider anymore; when no data has been
 * persisted yet (for example before the scheduler's first successful
 * run), callers get an explicit `available: false` result instead of a
 * fabricated price.
 */
export const dbMarketPriceProvider: MarketPriceProvider = {
  async getCurrentPrice(options = {}): Promise<MarketPriceResult> {
    const biddingZone = options.biddingZone ?? DEFAULT_BIDDING_ZONE;
    const referenceDate = options.referenceDate ?? new Date();

    const row = await prisma.marketPrice.findFirst({
      where: {
        biddingZone,
        timestamp: { lte: referenceDate },
      },
      orderBy: { timestamp: "desc" },
    });

    if (!row) {
      return { available: false, reason: "no_persisted_price_data" };
    }

    return { available: true, price: toMarketPrice(row) };
  },

  async getDayAheadPrices(options = {}): Promise<MarketPriceSeriesResult> {
    const biddingZone = options.biddingZone ?? DEFAULT_BIDDING_ZONE;
    const referenceDate = options.referenceDate ?? new Date();
    const timeZone = options.timeZone ?? ENTSOE_MARKET_TIMEZONE;

    // Windowed by `timeZone`'s own local-day boundary (a naive UTC
    // calendar day would miss/include the wrong hours — see
    // lib/market-price/timezone.ts). `MarketPrice.timestamp` rows are real
    // absolute instants, so any correct zone works here regardless of
    // which CET market day the importer originally fetched them under —
    // see this method's `timeZone` doc comment.
    const { start: startOfDay, end: endOfDay } = localDayBoundsUtc(
      referenceDate,
      timeZone,
    );

    const rows = await prisma.marketPrice.findMany({
      where: {
        biddingZone,
        timestamp: { gte: startOfDay, lt: endOfDay },
      },
      orderBy: { timestamp: "asc" },
    });

    if (rows.length === 0) {
      return {
        available: false,
        reason: "no_persisted_price_data_for_requested_day",
      };
    }

    return { available: true, prices: rows.map(toMarketPrice) };
  },

  async getIntradayPrices(): Promise<MarketPriceSeriesResult> {
    return { available: false, reason: "intraday_prices_not_implemented" };
  },

  async getLatestImportStatus(options = {}): Promise<MarketPriceImportStatus> {
    const biddingZone = options.biddingZone ?? DEFAULT_BIDDING_ZONE;

    const row = await prisma.marketPriceImport.findFirst({
      where: { biddingZone },
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
      resolutionMinutes: row.resolutionMinutes,
      importedAt: row.importedAt,
    };
  },
};
