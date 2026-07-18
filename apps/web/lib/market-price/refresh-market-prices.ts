/**
 * Market price scheduler logic — fetches today's day-ahead prices from
 * ENTSO-E and persists them. This is the only module allowed to write to
 * the `MarketPrice` table; the Market Price Provider
 * (`lib/market-price/provider.ts`) only ever reads from it.
 *
 * Called by `app/api/internal/market-price/refresh-prices/route.ts`,
 * mirroring `lib/fusionsolar/ingest-plant-telemetry.ts` /
 * `app/api/internal/fusionsolar/ingest-plant-telemetry` — same
 * externally-triggered, `CRON_SECRET`-guarded pattern, not Vercel's
 * built-in cron (see CLAUDE.md's "Known gaps" on why that was reverted for
 * telemetry ingestion).
 */

import {
  DEFAULT_BIDDING_ZONE,
  MARKET_PRICE_SOURCE_ENTSOE,
} from "@/lib/market-price/constants";
import { fetchEntsoeDayAheadPrices } from "@/lib/market-price/providers/entsoe";
import { prisma } from "@/lib/prisma";

export type MarketPriceRefreshResult = {
  biddingZone: string;
  pricesFetched: number;
  pricesUpserted: number;
};

/**
 * Fetches and persists today's (UTC calendar day) day-ahead prices for the
 * configured bidding zone. Idempotent: re-running for the same day
 * upserts existing rows rather than duplicating them.
 */
export async function refreshMarketPrices(): Promise<MarketPriceRefreshResult> {
  const now = new Date();
  const periodStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const periodEnd = new Date(periodStart.getTime() + 24 * 60 * 60 * 1000);

  const points = await fetchEntsoeDayAheadPrices({
    biddingZone: DEFAULT_BIDDING_ZONE,
    periodStart,
    periodEnd,
  });

  let pricesUpserted = 0;

  for (const point of points) {
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

    pricesUpserted += 1;
  }

  return {
    biddingZone: DEFAULT_BIDDING_ZONE,
    pricesFetched: points.length,
    pricesUpserted,
  };
}
