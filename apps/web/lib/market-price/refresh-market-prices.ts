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
  MARKET_PRICE_SOURCE_IBEX,
} from "@/lib/market-price/constants";
import {
  EntsoeNoDataAvailableError,
  fetchEntsoeDayAheadPrices,
} from "@/lib/market-price/providers/entsoe";
import {
  IbexNoDataAvailableError,
  fetchIbexDayAheadPrices,
} from "@/lib/market-price/providers/ibex";
import {
  ENTSOE_MARKET_TIMEZONE,
  formatDateInZone,
  localDayBoundsUtc,
} from "@/lib/market-price/timezone";
import { prisma } from "@/lib/prisma";
import { recordImporterRun } from "@/lib/admin/importer-run";

const IMPORTER_TYPE = "entsoe_market_price";
const IBEX_IMPORTER_TYPE = "ibex_market_price";

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

type PersistableDayAheadSeries = {
  points: Array<{ timestamp: Date; price: number; currency: string }>;
  resolutionMinutes: number;
  expectedIntervals: number;
  missingTimestamps: Date[];
  isPartial: boolean;
};

/**
 * Shared persistence tail for both providers: upserts every point (never
 * duplicated - `@@unique([biddingZone, timestamp, source])`, self-healing
 * if a provider ever revises an already-published value), writes one
 * `MarketPriceImport` row, and records the `ImporterRun`. `source`/
 * `importerType` are the only things that differ between an ENTSO-E and an
 * IBEX import - everything else (validation already happened in the
 * respective provider) is identical, so this is the one place that writes
 * to `MarketPrice`/`MarketPriceImport`, regardless of which provider
 * produced the series.
 */
async function persistDayAheadSeries(params: {
  series: PersistableDayAheadSeries;
  periodStart: Date;
  periodEnd: Date;
  source: string;
  importerType: string;
  targetDeliveryDay: string;
  startedAt: Date;
  logLabel: string;
}): Promise<MarketPriceRefreshResult> {
  const { series, periodStart, periodEnd, source, importerType, targetDeliveryDay, startedAt, logLabel } = params;

  // Determined before writing, purely for accurate "inserted vs
  // duplicate" logging - does not change write behavior below, which
  // still upserts every point exactly as before.
  const existing = await prisma.marketPrice.findMany({
    where: {
      biddingZone: DEFAULT_BIDDING_ZONE,
      source,
      timestamp: { gte: periodStart, lt: periodEnd },
    },
    select: { timestamp: true },
  });
  const existingTimestamps = new Set(existing.map((row) => row.timestamp.getTime()));

  let recordsInserted = 0;
  let duplicatesSkipped = 0;

  for (const point of series.points) {
    const alreadyExists = existingTimestamps.has(point.timestamp.getTime());

    await prisma.marketPrice.upsert({
      where: {
        biddingZone_timestamp_source: {
          biddingZone: DEFAULT_BIDDING_ZONE,
          timestamp: point.timestamp,
          source,
        },
      },
      create: {
        biddingZone: DEFAULT_BIDDING_ZONE,
        timestamp: point.timestamp,
        price: point.price,
        currency: point.currency,
        source,
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
      missingTimestamps: series.missingTimestamps.map((timestamp) => timestamp.toISOString()),
      source,
    },
  });

  console.log(`[${logLabel}] Delivery day processed`, {
    biddingZone: DEFAULT_BIDDING_ZONE,
    targetDeliveryDay,
    source,
    recordsDownloaded: series.points.length,
    recordsInserted,
    duplicatesSkipped,
    missingIntervals: series.missingTimestamps.length,
    isPartial: series.isPartial,
  });

  await recordImporterRun({
    importerType,
    organizationId: null,
    startedAt,
    status: "SUCCESS",
    rowsImported: recordsInserted,
    rowsSkipped: duplicatesSkipped,
    rowsFailed: series.missingTimestamps.length,
    details: { targetDeliveryDay, isPartial: series.isPartial, source },
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

/**
 * Fetches and persists one (CET/CEST market day) day-ahead prices from
 * ENTSO-E (PRIMARY source) for the configured bidding zone. Defaults to
 * today; pass `referenceDate` to refresh/backfill a past day instead (see
 * `backfillMarketPrices` below). Idempotent: re-running for the same day
 * upserts existing `MarketPrice` rows rather than duplicating them, and
 * always records a fresh `MarketPriceImport` row describing the outcome.
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

  return persistDayAheadSeries({
    series,
    periodStart,
    periodEnd,
    source: MARKET_PRICE_SOURCE_ENTSOE,
    importerType: IMPORTER_TYPE,
    targetDeliveryDay,
    startedAt,
    logLabel: "Market Price Refresh",
  });
}

/**
 * The IBEX counterpart of `refreshMarketPrices` — SECONDARY/FALLBACK only,
 * never called on its own by any scheduled trigger; only
 * `ensureMarketPricesForBulgariaDays` calls this, and only after an
 * ENTSO-E attempt for the same CET day has already failed, been
 * unavailable, or left the day incomplete. Same CET-day framing, same
 * persistence path (`persistDayAheadSeries`), same idempotency guarantee -
 * the only difference is the provider and the `source` column value.
 */
export async function refreshMarketPricesFromIbex(
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
    series = await fetchIbexDayAheadPrices({ periodStart, periodEnd });
  } catch (error) {
    if (error instanceof IbexNoDataAvailableError) {
      console.log("[Market Price Refresh] No IBEX data available yet", {
        biddingZone: DEFAULT_BIDDING_ZONE,
        targetDeliveryDay,
        reason: error.message,
      });

      await recordImporterRun({
        importerType: IBEX_IMPORTER_TYPE,
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
      importerType: IBEX_IMPORTER_TYPE,
      organizationId: null,
      startedAt,
      status: "FAILED",
      errorMessage: error instanceof Error ? error.message : "unknown_error",
      details: { targetDeliveryDay },
    });

    throw error;
  }

  return persistDayAheadSeries({
    series,
    periodStart,
    periodEnd,
    source: MARKET_PRICE_SOURCE_IBEX,
    importerType: IBEX_IMPORTER_TYPE,
    targetDeliveryDay,
    startedAt,
    logLabel: "Market Price Refresh (IBEX fallback)",
  });
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
 * treated as incomplete. Read-only — makes no ENTSO-E/IBEX request.
 *
 * IBEX Fallback milestone: deliberately NOT filtered by `source`. A CET
 * day completed via the IBEX fallback is exactly as "done" as one
 * completed via ENTSO-E - checking either source here is what makes every
 * caller of this function (the trailing recovery sweep, the on-demand
 * safeguard) correctly stop retrying ENTSO-E once IBEX has already filled
 * the gap, instead of endlessly re-attempting a source that keeps failing
 * while a complete dataset already exists under the other one.
 */
async function isCetDayImportComplete(periodStart: Date): Promise<boolean> {
  const completeImport = await prisma.marketPriceImport.findFirst({
    where: {
      biddingZone: DEFAULT_BIDDING_ZONE,
      periodStart,
      isPartial: false,
    },
    select: { id: true },
  });

  return completeImport !== null;
}

/**
 * The (up to 2) CET/CEST calendar-day components a single Bulgaria-local
 * day overlaps - see `BULGARIA_CET_OVERLAP_DAYS`'s own doc comment for why
 * a Bulgaria day is never exactly one CET day. Shared by
 * `ensureMarketPricesForBulgariaDays` below (needs the reference instant to
 * actually fetch a CET day that isn't complete yet) and
 * `isBulgariaLocalDayComplete` further below (only needs the CET day start
 * to check completeness) - factored out once both needed the identical
 * computation, not a new calculation.
 */
function bulgariaDayCetComponents(
  dayStart: Date,
): Array<{ cetDayStart: Date; referenceInstant: Date }> {
  const leadingHourInstant = new Date(dayStart.getTime() + 30 * 60 * 1000);
  const restOfDayInstant = new Date(dayStart.getTime() + 12 * 60 * 60 * 1000);

  return [leadingHourInstant, restOfDayInstant].map((referenceInstant) => ({
    referenceInstant,
    cetDayStart: localDayBoundsUtc(referenceInstant, ENTSOE_MARKET_TIMEZONE).start,
  }));
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
 *
 * IBEX Fallback milestone: ENTSO-E remains PRIMARY - it is always tried
 * first for a CET day that isn't already complete. Only if that attempt
 * fails, times out, reports no data, or leaves the day partial does this
 * function fall back to IBEX for that SAME CET day (never per-interval -
 * `refreshMarketPricesFromIbex` always fetches the entire day, exactly
 * like `refreshMarketPrices`). If IBEX also fails, the day is left
 * incomplete and this function reports it via `imported: false`/`errors`,
 * same as before - nothing here ever fabricates or partially substitutes
 * a price.
 *
 * `overrides` exist only for tests - production callers always get the
 * real completeness check and the real ENTSO-E/IBEX refresh functions.
 */
export async function ensureMarketPricesForBulgariaDays(
  dayStarts: Date[],
  deadline?: number,
  overrides: {
    isComplete?: (periodStart: Date) => Promise<boolean>;
    refreshEntsoe?: (referenceInstant: Date) => Promise<MarketPriceRefreshResult>;
    refreshIbex?: (referenceInstant: Date) => Promise<MarketPriceRefreshResult>;
  } = {},
): Promise<{ imported: boolean; errors: string[]; fallbackUsed: boolean }> {
  const isComplete = overrides.isComplete ?? isCetDayImportComplete;
  const refreshEntsoe = overrides.refreshEntsoe ?? refreshMarketPrices;
  const refreshIbex = overrides.refreshIbex ?? refreshMarketPricesFromIbex;

  const cetReferenceInstants = new Map<number, Date>();

  for (const dayStart of dayStarts) {
    for (const { cetDayStart, referenceInstant } of bulgariaDayCetComponents(dayStart)) {
      cetReferenceInstants.set(cetDayStart.getTime(), referenceInstant);
    }
  }

  const errors: string[] = [];
  let imported = true;
  let fallbackUsed = false;

  for (const [cetDayStartMs, referenceInstant] of cetReferenceInstants) {
    if (deadline !== undefined && Date.now() >= deadline) {
      break;
    }

    if (await isComplete(new Date(cetDayStartMs))) {
      continue;
    }

    let dayComplete = false;

    try {
      const result = await refreshEntsoe(referenceInstant);

      if (!result.unavailable && !result.isPartial) {
        dayComplete = true;
      }
    } catch (error) {
      errors.push(`ENTSO-E: ${error instanceof Error ? error.message : "unknown_error"}`);
    }

    if (!dayComplete) {
      try {
        const ibexResult = await refreshIbex(referenceInstant);

        if (!ibexResult.unavailable && !ibexResult.isPartial) {
          dayComplete = true;
          fallbackUsed = true;
        }
      } catch (error) {
        errors.push(`IBEX: ${error instanceof Error ? error.message : "unknown_error"}`);
      }
    }

    if (!dayComplete) {
      imported = false;
    }
  }

  return { imported, errors, fallbackUsed };
}

const BULGARIA_TIMEZONE = "Europe/Sofia";

/**
 * On-Demand Delivery Day Recovery milestone. Is EVERY CET-day component of
 * this Bulgaria-local day already a complete, successful import? Mirrors
 * `isCetDayImportComplete`'s own "isPartial: false is the only complete
 * signal" rule, generalized across both CET days a Bulgaria day spans (via
 * the same `bulgariaDayCetComponents` helper `ensureMarketPricesForBulgariaDays`
 * uses). Read-only - makes no ENTSO-E request. Exported for
 * `ensure-delivery-day-available.ts`'s on-demand safeguard, which needs to
 * know "is recovery even necessary" both before and after acquiring its
 * advisory lock.
 */
export async function isBulgariaLocalDayComplete(dayStart: Date): Promise<boolean> {
  for (const { cetDayStart } of bulgariaDayCetComponents(dayStart)) {
    if (!(await isCetDayImportComplete(cetDayStart))) {
      return false;
    }
  }

  return true;
}

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
export type RecoverySweepResult = { imported: boolean; errors: string[]; fallbackUsed: boolean };

export async function recoverRecentIncompleteDays(
  referenceDate = new Date(),
): Promise<RecoverySweepResult> {
  const dayStarts: Date[] = [];

  for (let daysAgo = 1; daysAgo <= TRAILING_RECOVERY_WINDOW_DAYS; daysAgo += 1) {
    const instant = new Date(referenceDate.getTime() - daysAgo * ONE_DAY_MS);
    dayStarts.push(localDayBoundsUtc(instant, BULGARIA_TIMEZONE).start);
  }

  return ensureMarketPricesForBulgariaDays(dayStarts);
}

export type PrimaryCetDayResult = { result: MarketPriceRefreshResult; fallbackUsed: boolean };

/**
 * Scheduler Operational Resilience milestone. Refreshes the PRIMARY
 * scheduled CET day (the "tomorrow" target the 14:00 Europe/Sofia timer,
 * and its now-hourly retries via the VM poll script, are trying to
 * complete) - ENTSO-E first, falling back to IBEX only if ENTSO-E fails,
 * is unavailable, or leaves the day partial. Never per-interval - always
 * the full CET day, exactly like `refreshMarketPrices`/
 * `refreshMarketPricesFromIbex` themselves.
 *
 * This exists as a small, separate function - not shared code with
 * `ensureMarketPricesForBulgariaDays`'s own per-CET-day fallback loop
 * below, to avoid touching that already-tested logic - so that EVERY
 * scheduled attempt for the delivery day currently being completed tries
 * IBEX immediately once ENTSO-E is confirmed incomplete, rather than only
 * the trailing-day recovery sweep doing so (which only ever looks at the
 * last 2 Bulgaria-local days, never "tomorrow" itself).
 *
 * Never swallows a "both sources failed" outcome into a false success: if
 * ENTSO-E fails/is unavailable/partial AND IBEX also fails outright
 * (throws), this throws too, preserving the caller's existing FAILED-run
 * handling with both reasons combined. If IBEX itself only reports
 * unavailable/partial without throwing, that result is returned as-is -
 * still correctly incomplete, never marked done.
 *
 * `overrides` exist only for tests - production callers always get the
 * real `refreshMarketPrices`/`refreshMarketPricesFromIbex`.
 */
export async function refreshPrimaryCetDayWithFallback(
  referenceDate: Date,
  overrides: {
    refreshEntsoe?: (referenceInstant: Date) => Promise<MarketPriceRefreshResult>;
    refreshIbex?: (referenceInstant: Date) => Promise<MarketPriceRefreshResult>;
  } = {},
): Promise<PrimaryCetDayResult> {
  const refreshEntsoe = overrides.refreshEntsoe ?? refreshMarketPrices;
  const refreshIbex = overrides.refreshIbex ?? refreshMarketPricesFromIbex;

  let entsoeResult: MarketPriceRefreshResult | undefined;
  let entsoeError: unknown;

  try {
    entsoeResult = await refreshEntsoe(referenceDate);
  } catch (error) {
    entsoeError = error;
  }

  if (entsoeResult && !entsoeResult.unavailable && !entsoeResult.isPartial) {
    return { result: entsoeResult, fallbackUsed: false };
  }

  try {
    const ibexResult = await refreshIbex(referenceDate);
    return { result: ibexResult, fallbackUsed: true };
  } catch (ibexError) {
    const entsoeMessage =
      entsoeError instanceof Error
        ? entsoeError.message
        : entsoeError
          ? String(entsoeError)
          : entsoeResult
            ? `incomplete/unavailable (${entsoeResult.importedIntervals}/${entsoeResult.expectedIntervals})`
            : "unknown";
    const ibexMessage = ibexError instanceof Error ? ibexError.message : String(ibexError);

    throw new Error(`ENTSO-E: ${entsoeMessage}; IBEX: ${ibexMessage}`);
  }
}

export type ScheduledTomorrowRefreshResult = {
  result: MarketPriceRefreshResult;
  primaryFallbackUsed: boolean;
  recovery: RecoverySweepResult | null;
  recoveryError: unknown;
};

/**
 * Scheduled Market Price Refresh Resilience milestone, resilience follow-up
 * (2026-09-01 sustained ENTSO-E outage). Runs the primary "tomorrow" import
 * and the trailing recovery sweep as two independent steps.
 * `app/api/internal/market-price/refresh-prices/route.ts` previously only
 * ever called `recoverRecentIncompleteDays` after a successful primary
 * import, so an ENTSO-E outage that failed every "tomorrow" attempt also
 * silently prevented the trailing 2-day recovery sweep from ever running.
 * Recovery is now always attempted, even when the primary import throws.
 * The primary error is still rethrown afterward (never swallowed), so the
 * route's existing FAILED `SchedulerRun` / error-response handling for the
 * primary import is unchanged.
 *
 * Scheduler Operational Resilience milestone: the primary step itself now
 * goes through `refreshPrimaryCetDayWithFallback` (ENTSO-E then IBEX for
 * "tomorrow"), not `refreshMarketPrices` alone - see that function's own
 * doc comment for why this is a separate concern from the trailing
 * recovery sweep's own, pre-existing fallback.
 *
 * `refresh`/`recover` overrides exist only for tests — production callers
 * always get the real `refreshPrimaryCetDayWithFallback`/
 * `recoverRecentIncompleteDays`.
 */
export async function refreshTomorrowWithTrailingRecovery(
  referenceDate: Date = new Date(Date.now() + ONE_DAY_MS),
  overrides: {
    refresh?: () => Promise<PrimaryCetDayResult>;
    recover?: () => Promise<RecoverySweepResult>;
  } = {},
): Promise<ScheduledTomorrowRefreshResult> {
  const refresh = overrides.refresh ?? (() => refreshPrimaryCetDayWithFallback(referenceDate));
  const recover = overrides.recover ?? (() => recoverRecentIncompleteDays());

  let result: MarketPriceRefreshResult | undefined;
  let primaryFallbackUsed = false;
  let primaryError: unknown;

  try {
    const outcome = await refresh();
    result = outcome.result;
    primaryFallbackUsed = outcome.fallbackUsed;
  } catch (error) {
    primaryError = error;
  }

  let recovery: RecoverySweepResult | null = null;
  let recoveryError: unknown;

  try {
    recovery = await recover();
  } catch (error) {
    recoveryError = error;
  }

  if (primaryError) {
    throw primaryError;
  }

  return { result: result!, primaryFallbackUsed, recovery, recoveryError };
}

/**
 * Hard escalation deadline hour (Market Price Reliability milestone,
 * follow-up correcting the earlier "morning check" design): 05:00
 * Europe/Sofia. This is deliberately an ESCALATION point for an incident
 * that has already been open and retrying since the 14:00 primary import
 * first failed - never the moment recovery "starts." It sits comfortably
 * before the 06:00 operational window and far beyond ENTSO-E's normal
 * ~14:00-14:30 publication lag, so reaching it while still incomplete
 * always means something is genuinely wrong, never routine latency.
 */
const RECOVERY_DEADLINE_HOUR_SOFIA = 5;

/**
 * The hard recovery-escalation deadline for the delivery day `tomorrow`
 * refers to (the same reference date the primary "tomorrow" import itself
 * uses) - 05:00 Europe/Sofia on that delivery day's own Bulgaria-local
 * calendar date. Computed independently of whether the primary import ever
 * succeeded (needed in the failure path too, where there is no
 * `MarketPriceRefreshResult.periodStart` to read).
 */
export function computeRecoveryDeadline(tomorrow: Date): Date {
  const cetPeriodStart = localDayBoundsUtc(tomorrow, ENTSOE_MARKET_TIMEZONE).start;
  const bulgariaDayStart = localDayBoundsUtc(cetPeriodStart, BULGARIA_TIMEZONE).start;

  return new Date(bulgariaDayStart.getTime() + RECOVERY_DEADLINE_HOUR_SOFIA * 60 * 60 * 1000);
}
