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
import {
  EntsoeNoDataAvailableError,
  fetchEntsoeDayAheadPrices,
} from "@/lib/market-price/providers/entsoe";
import {
  ENTSOE_MARKET_TIMEZONE,
  formatDateInZone,
  localDayBoundsUtc,
} from "@/lib/market-price/timezone";
import { prisma } from "@/lib/prisma";
import { recordImporterRun } from "@/lib/admin/importer-run";

const IMPORTER_TYPE = "entsoe_market_price";

export type MarketPriceRefreshResult = {
  biddingZone: string;
  periodStart: Date;
  periodEnd: Date;
  expectedIntervals: number;
  importedIntervals: number;
  missingIntervals: number;
  isPartial: boolean;
  recordsInserted: number;
  duplicatesSkipped: number;
  /** True when ENTSO-E has not published this period yet (see `EntsoeNoDataAvailableError`). */
  unavailable: boolean;
};

/**
 * Fetches and persists one (CET/CEST market day) day-ahead prices for the
 * configured bidding zone. Defaults to today; pass `referenceDate` to
 * refresh/backfill a past day instead (see `backfillMarketPrices` below).
 * Idempotent: re-running for the same day upserts existing `MarketPrice`
 * rows rather than duplicating them, and always records a fresh
 * `MarketPriceImport` row describing the outcome.
 *
 * Never fabricates or interpolates missing intervals — see
 * `lib/market-price/providers/entsoe.ts` for the validation/partial-import
 * policy this relies on.
 */
export async function refreshMarketPrices(
  referenceDate = new Date(),
): Promise<MarketPriceRefreshResult> {
  const startedAt = new Date();
  const { start: periodStart, end: periodEnd } = localDayBoundsUtc(
    referenceDate,
    ENTSOE_MARKET_TIMEZONE,
  );
  const targetDeliveryDay = formatDateInZone(periodStart, ENTSOE_MARKET_TIMEZONE);

  let series;

  try {
    series = await fetchEntsoeDayAheadPrices({
      biddingZone: DEFAULT_BIDDING_ZONE,
      periodStart,
      periodEnd,
    });
  } catch (error) {
    if (error instanceof EntsoeNoDataAvailableError) {
      console.log("[Market Price Refresh] No ENTSO-E data available yet", {
        biddingZone: DEFAULT_BIDDING_ZONE,
        targetDeliveryDay,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        reason: error.message,
      });

      await recordImporterRun({
        importerType: IMPORTER_TYPE,
        organizationId: null,
        startedAt,
        status: "SKIPPED",
        details: { targetDeliveryDay, reason: error.message },
      });

      return {
        biddingZone: DEFAULT_BIDDING_ZONE,
        periodStart,
        periodEnd,
        expectedIntervals: 0,
        importedIntervals: 0,
        missingIntervals: 0,
        isPartial: true,
        recordsInserted: 0,
        duplicatesSkipped: 0,
        unavailable: true,
      };
    }

    await recordImporterRun({
      importerType: IMPORTER_TYPE,
      organizationId: null,
      startedAt,
      status: "FAILED",
      errorMessage: error instanceof Error ? error.message : "unknown_error",
      details: { targetDeliveryDay },
    });

    throw error;
  }

  // Determined before writing, purely for accurate "inserted vs
  // duplicate" logging (see step 4/6 of the Continuous ENTSO-E Daily
  // Price Refresh milestone) - does not change write behavior below,
  // which still upserts every point exactly as before (self-healing if
  // ENTSO-E ever revises an already-published value).
  const existing = await prisma.marketPrice.findMany({
    where: {
      biddingZone: DEFAULT_BIDDING_ZONE,
      source: MARKET_PRICE_SOURCE_ENTSOE,
      timestamp: { gte: periodStart, lt: periodEnd },
    },
    select: { timestamp: true },
  });
  const existingTimestamps = new Set(
    existing.map((row) => row.timestamp.getTime()),
  );

  let recordsInserted = 0;
  let duplicatesSkipped = 0;

  for (const point of series.points) {
    const alreadyExists = existingTimestamps.has(point.timestamp.getTime());

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

    if (alreadyExists) {
      duplicatesSkipped += 1;
    } else {
      recordsInserted += 1;
    }
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

  console.log("[Market Price Refresh] Delivery day processed", {
    biddingZone: DEFAULT_BIDDING_ZONE,
    targetDeliveryDay,
    recordsDownloaded: series.points.length,
    recordsInserted,
    duplicatesSkipped,
    missingIntervals: series.missingTimestamps.length,
    isPartial: series.isPartial,
  });

  await recordImporterRun({
    importerType: IMPORTER_TYPE,
    organizationId: null,
    startedAt,
    status: "SUCCESS",
    rowsImported: recordsInserted,
    rowsSkipped: duplicatesSkipped,
    rowsFailed: series.missingTimestamps.length,
    details: { targetDeliveryDay, isPartial: series.isPartial },
  });

  return {
    biddingZone: DEFAULT_BIDDING_ZONE,
    periodStart,
    periodEnd,
    expectedIntervals: series.expectedIntervals,
    importedIntervals: series.points.length,
    missingIntervals: series.missingTimestamps.length,
    isPartial: series.isPartial,
    recordsInserted,
    duplicatesSkipped,
    unavailable: false,
  };
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Bulgaria (Europe/Sofia) is always exactly one hour ahead of the CET/CEST
 * reference zone this importer fetches against (both observe the same
 * EU-wide DST transition dates, just from a different standard offset) —
 * so Bulgaria's local midnight always falls at 23:00 CET/CEST the
 * *previous* CET calendar day. Backfilling `daysBack` complete Bulgaria
 * local days therefore requires fetching one additional CET day older
 * than `daysBack` to cover that leading hour; the newest CET day already
 * covers all of "today" (Bulgaria's local today never reaches into
 * tomorrow's CET day). See `market-data.ts` / Goal 3 of the Historical
 * Backfill + Timeline Alignment milestone for the Sofia-local display side
 * of this same fact.
 */
const BULGARIA_CET_OVERLAP_DAYS = 1;

export type MarketPriceBackfillResult = {
  daysRequested: number;
  daysFetched: number;
  perDay: Array<MarketPriceRefreshResult & { reason?: string }>;
  failures: Array<{ periodStart: string; reason: string }>;
};

/**
 * Backfills `daysBack` complete local (Bulgaria) calendar days plus today,
 * by refreshing each underlying CET/CEST market day one at a time (see
 * `BULGARIA_CET_OVERLAP_DAYS`). Reuses `refreshMarketPrices`'s existing
 * per-day upsert, so this is idempotent day-by-day exactly like a single
 * `refreshMarketPrices()` call — re-running the backfill (or overlapping
 * it with the periodic single-day refresh) never duplicates a row, only
 * ever upserts the same real price.
 */
export async function backfillMarketPrices(
  daysBack: number,
): Promise<MarketPriceBackfillResult> {
  const now = new Date();
  const totalCetDays = daysBack + BULGARIA_CET_OVERLAP_DAYS;

  const perDay: MarketPriceBackfillResult["perDay"] = [];
  const failures: MarketPriceBackfillResult["failures"] = [];

  for (let daysAgo = totalCetDays; daysAgo >= 0; daysAgo -= 1) {
    const referenceDate = new Date(now.getTime() - daysAgo * ONE_DAY_MS);

    try {
      const result = await refreshMarketPrices(referenceDate);
      perDay.push(result);
    } catch (error) {
      const { start } = localDayBoundsUtc(referenceDate, ENTSOE_MARKET_TIMEZONE);

      failures.push({
        periodStart: start.toISOString(),
        reason: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }

  return {
    daysRequested: totalCetDays + 1,
    daysFetched: perDay.length,
    perDay,
    failures,
  };
}

/**
 * Scheduled Market Price Refresh Resilience milestone. Whether a CET
 * calendar day (identified by its `periodStart`, the same value
 * `refreshMarketPrices` always writes to `MarketPriceImport.periodStart`
 * for that day) already has a complete, successful import — checked
 * against `MarketPriceImport` evidence only, never `MarketPrice` row
 * presence. This distinction is load-bearing: the real 2026-08-26 incident
 * left exactly 4 real `MarketPrice` rows for that delivery day (residual
 * coverage from the *adjacent* CET day's own successful import), which
 * would make a naive "does any row exist" check wrongly report the day as
 * already done. `isPartial` is set directly from
 * `EntsoeDayAheadPriceSeries.isPartial` (`missingTimestamps.length > 0`) at
 * import time, so `isPartial: false` already means "every expected
 * interval for this CET day was actually imported" — no separate
 * `importedIntervals`/`expectedIntervals` comparison is needed on top of
 * it. A CET day with no `MarketPriceImport` row at all (never successfully
 * imported, or only ever hit `EntsoeNoDataAvailableError`/a thrown
 * `EntsoeApiError` — neither of which ever creates a row) is correctly
 * treated as incomplete. Read-only — makes no ENTSO-E request.
 */
async function isCetDayImportComplete(periodStart: Date): Promise<boolean> {
  const completeImport = await prisma.marketPriceImport.findFirst({
    where: {
      biddingZone: DEFAULT_BIDDING_ZONE,
      source: MARKET_PRICE_SOURCE_ENTSOE,
      periodStart,
      isPartial: false,
    },
    select: { id: true },
  });

  return completeImport !== null;
}

/**
 * Historical Data Coverage milestone. Ensures ENTSO-E prices are imported
 * for an arbitrary set of past Bulgaria-local days (each a `dayStart` from
 * `localDayBoundsUtc(date, "Europe/Sofia")`) — the on-demand counterpart to
 * `backfillMarketPrices` above, which always backfills relative to "now."
 * Reuses the exact same `BULGARIA_CET_OVERLAP_DAYS` fact and the same
 * underlying `refreshMarketPrices` this file already exposes — not a new
 * importer.
 *
 * Every Bulgaria day needs the two CET/CEST calendar days it overlaps
 * fetched, but adjacent Bulgaria days share one of those two CET days -
 * deduplicated here (keyed by which CET calendar day a reference instant
 * falls in) so a run of N consecutive missing days costs N+1
 * `refreshMarketPrices` calls, not 2N, matching this milestone's
 * requirement to import "only the missing days," not redundantly re-fetch
 * shared CET coverage. Idempotent for the same reason `refreshMarketPrices`
 * already is (upsert on `(biddingZone, timestamp, source)`), so even
 * without this dedup nothing would ever be double-imported - this exists
 * purely to bound the number of real ENTSO-E requests for a large range
 * (e.g. a full year).
 *
 * `deadline` (optional, an absolute `Date.now()`-comparable timestamp) is
 * the same wall-clock safety budget `ensureHistoricalRangeAvailable`
 * applies to its own Huawei imports - checked before each `refreshMarketPrices`
 * call, in chronological order, so a request that runs out of time simply
 * stops and leaves the remaining days to the next call (idempotent, so
 * nothing is lost or duplicated by stopping early).
 *
 * Scheduled Market Price Refresh Resilience milestone: each CET day is now
 * also checked via `isCetDayImportComplete` before dispatching a real
 * ENTSO-E call — a day already confirmed complete is skipped entirely (no
 * ENTSO-E request, no wasted call), which is what makes it safe for
 * `recoverRecentIncompleteDays` below to call this on every scheduled run
 * without turning the daily scheduler into a repeated full re-import.
 */
export async function ensureMarketPricesForBulgariaDays(
  dayStarts: Date[],
  deadline?: number,
): Promise<{ imported: boolean; errors: string[] }> {
  const cetReferenceInstants = new Map<number, Date>();

  for (const dayStart of dayStarts) {
    const leadingHourInstant = new Date(dayStart.getTime() + 30 * 60 * 1000);
    const restOfDayInstant = new Date(dayStart.getTime() + 12 * 60 * 60 * 1000);

    for (const instant of [leadingHourInstant, restOfDayInstant]) {
      const cetDayStart = localDayBoundsUtc(instant, ENTSOE_MARKET_TIMEZONE).start.getTime();
      cetReferenceInstants.set(cetDayStart, instant);
    }
  }

  const errors: string[] = [];
  let imported = true;

  for (const [cetDayStartMs, referenceInstant] of cetReferenceInstants) {
    if (deadline !== undefined && Date.now() >= deadline) {
      break;
    }

    if (await isCetDayImportComplete(new Date(cetDayStartMs))) {
      continue;
    }

    try {
      const result = await refreshMarketPrices(referenceInstant);
      if (result.unavailable) {
        imported = false;
      }
    } catch (error) {
      imported = false;
      errors.push(error instanceof Error ? error.message : "unknown_error");
    }
  }

  return { imported, errors };
}

const BULGARIA_TIMEZONE = "Europe/Sofia";

/**
 * Deliberately bounded to 2 trailing days, not open-ended — see the
 * Scheduled Market Price Refresh Resilience design discussion this
 * milestone is based on. A day that remains invalid past this window is
 * left to the existing, separate historical backfill mechanisms
 * (`backfillMarketPrices` above, or the admin historical-imports tool) —
 * this keeps the daily scheduler's own job small and cheap (typically zero
 * extra ENTSO-E calls once recent days are already complete, thanks to
 * `isCetDayImportComplete` above), rather than turning it into a
 * general-purpose backfill job.
 */
const TRAILING_RECOVERY_WINDOW_DAYS = 2;

/**
 * Scheduled Market Price Refresh Resilience milestone. Reconsiders the
 * last `TRAILING_RECOVERY_WINDOW_DAYS` Bulgaria-local delivery days on
 * every scheduled run, in addition to (never instead of) the existing
 * `target=tomorrow` single-day refresh (see
 * `app/api/internal/market-price/refresh-prices/route.ts`) — recovers a
 * day whose import failed (invalid/ambiguous ENTSO-E data, a network
 * failure, etc.) once ENTSO-E's data for that day becomes valid on a later
 * day, without weakening the parser's strict validation and without a new
 * cron unit or a new retry/state-machine table. Reuses
 * `ensureMarketPricesForBulgariaDays` verbatim — the only new behavior is
 * that function's own completeness pre-check (`isCetDayImportComplete`)
 * plus this function's trailing-window computation. Never touches
 * `parseEntsoeDayAheadPricesXml` or any validation rule — a day that's
 * still genuinely invalid is rejected exactly as before and simply
 * remains eligible for the next scheduled run to try again.
 */
export async function recoverRecentIncompleteDays(
  referenceDate = new Date(),
): Promise<{ imported: boolean; errors: string[] }> {
  const dayStarts: Date[] = [];

  for (let daysAgo = 1; daysAgo <= TRAILING_RECOVERY_WINDOW_DAYS; daysAgo += 1) {
    const instant = new Date(referenceDate.getTime() - daysAgo * ONE_DAY_MS);
    dayStarts.push(localDayBoundsUtc(instant, BULGARIA_TIMEZONE).start);
  }

  return ensureMarketPricesForBulgariaDays(dayStarts);
}
