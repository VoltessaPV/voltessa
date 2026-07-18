/**
 * Market price scheduler logic — fetches today's day-ahead prices from
 * ENTSO-E and persists them. This is the only module allowed to write to
 * the `MarketPrice`/`MarketPriceImport` tables; the Market Price Provider
 * (`lib/market-price/provider.ts`) only ever reads from them.
 *
 * Called by `app/api/internal/market-price/refresh-prices/route.ts`,
 * mirroring `lib/fusionsolar/ingest-plant-telemetry.ts` /
 * `app/api/internal/fusionsolar/ingest-plant-telemetry` — same
 * externally-triggered, `CRON_SECRET`-guarded pattern, not Vercel's
 * built-in cron (see CLAUDE.md's "Known gaps" on why that was reverted for
 * telemetry ingestion).
 *
 * "Today" is computed in ENTSO-E's own CET/CEST market-day convention
 * (see `lib/market-price/timezone.ts`), not Bulgaria's own civil day.
 */

import {
  DEFAULT_BIDDING_ZONE,
  MARKET_PRICE_SOURCE_ENTSOE,
} from "@/lib/market-price/constants";
import { fetchEntsoeDayAheadPrices } from "@/lib/market-price/providers/entsoe";
import {
  ENTSOE_MARKET_TIMEZONE,
  localDayBoundsUtc,
} from "@/lib/market-price/timezone";
import { prisma } from "@/lib/prisma";

export type MarketPriceRefreshResult = {
  biddingZone: string;
  periodStart: Date;
  periodEnd: Date;
  expectedIntervals: number;
  importedIntervals: number;
  missingIntervals: number;
  isPartial: boolean;
};

/**
 * Fetches and persists today's (CET/CEST market day) day-ahead prices for
 * the configured bidding zone. Idempotent: re-running for the same day
 * upserts existing `MarketPrice` rows rather than duplicating them, and
 * always records a fresh `MarketPriceImport` row describing the outcome.
 *
 * Never fabricates or interpolates missing intervals — see
 * `lib/market-price/providers/entsoe.ts` for the validation/partial-import
 * policy this relies on.
 */
export async function refreshMarketPrices(): Promise<MarketPriceRefreshResult> {
  const { start: periodStart, end: periodEnd } = localDayBoundsUtc(
    new Date(),
    ENTSOE_MARKET_TIMEZONE,
  );

  const series = await fetchEntsoeDayAheadPrices({
    biddingZone: DEFAULT_BIDDING_ZONE,
    periodStart,
    periodEnd,
  });

  for (const point of series.points) {
    await prisma.marketPrice.upsert({
      where: {
        biddingZone_timestamp_source: {
          biddingZone: DEFAULT_BIDDING_ZONE,
          timestamp: point.timestamp,
          source: MARKET_PRICE_SOURCE_ENTSOE,
        },
      },
      create: {
        biddingZone: DEFAULT_BIDDING_ZONE,
        timestamp: point.timestamp,
        price: point.price,
        currency: point.currency,
        source: MARKET_PRICE_SOURCE_ENTSOE,
      },
      update: {
        price: point.price,
        currency: point.currency,
      },
    });
  }

  await prisma.marketPriceImport.create({
    data: {
      biddingZone: DEFAULT_BIDDING_ZONE,
      periodStart,
      periodEnd,
      resolutionMinutes: series.resolutionMinutes,
      expectedIntervals: series.expectedIntervals,
      importedIntervals: series.points.length,
      isPartial: series.isPartial,
      missingTimestamps: series.missingTimestamps.map((timestamp) =>
        timestamp.toISOString(),
      ),
      source: MARKET_PRICE_SOURCE_ENTSOE,
    },
  });

  return {
    biddingZone: DEFAULT_BIDDING_ZONE,
    periodStart,
    periodEnd,
    expectedIntervals: series.expectedIntervals,
    importedIntervals: series.points.length,
    missingIntervals: series.missingTimestamps.length,
    isPartial: series.isPartial,
  };
}
