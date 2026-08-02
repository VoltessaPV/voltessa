import type { FusionSolarConnection } from "@/lib/fusionsolar/api-client";
import { importDeviceTelemetry } from "@/lib/fusionsolar/import-device-telemetry";
import { importPlantDailyKpiRange } from "@/lib/fusionsolar/import-plant-daily-kpi";
import { ensureMarketPricesForBulgariaDays } from "@/lib/market-price/refresh-market-prices";
import { formatDateInZone, localDayBoundsUtc } from "@/lib/market-price/timezone";
import { prisma } from "@/lib/prisma";
import { recordImporterRun } from "@/lib/admin/importer-run";

const IMPORTER_TYPE = "historical_range";

/**
 * Historical Data Auto-Import / Historical Data Coverage milestones. The
 * single shared backend service every historical Dashboard/Market feature
 * calls before rendering — mirrors `lib/fusionsolar/telemetry-sync-service.ts`'s
 * own role for live telemetry freshness: pages ask "is this data available,"
 * never "how do I import FusionSolar/ENTSO-E data myself." No React
 * component/page ever calls `importDeviceTelemetry`, `importPlantDailyKpiRange`,
 * or `ensureMarketPricesForBulgariaDays` directly — only this file does.
 *
 * `ensureHistoricalRangeAvailable` is the real implementation: given an
 * arbitrary `[start, end)` of Bulgaria-local calendar days (a single day, a
 * Monday-Sunday week, a calendar month, a calendar year - the caller
 * decides, this file has no opinion on period length), it checks every
 * applicable day in one pass, imports only the missing days per data type,
 * and returns only once the whole range has been checked/imported.
 * `ensureHistoricalDayAvailable` (below) is a thin single-day convenience
 * wrapper around it, kept for Dashboard/Market's existing call sites - this
 * is the "same mechanism" every future historical feature (weekly/monthly/
 * yearly analytics, reports, exports, trader portfolio summaries, ...)
 * should also call, rather than each reimplementing its own gap-filling.
 *
 * Checks first, imports only what's missing, never re-fetches what's
 * already in Postgres. Idempotent by construction — every importer this
 * calls already upserts/skips-duplicates on its own unique key, so calling
 * this repeatedly for the same range is always safe and, once fully
 * imported, performs zero Huawei/ENTSO-E requests.
 *
 * Never imports today or the future: today's data is kept fresh by
 * `ensureTelemetryFresh`/the live schedulers instead, and Huawei/ENTSO-E
 * have nothing to report for a day that hasn't happened yet - today/future
 * days within a requested range are silently skipped (absent from the
 * returned `days` array), not reported as failures.
 *
 * ## Time budget (Historical Data Coverage reliability fix)
 *
 * A cold Week/Month/Year request can have many missing days, and every
 * Huawei/ENTSO-E call this file makes is a real, sequential network
 * round-trip (confirmed against production: a fully-missing week took
 * 67 seconds - 14 `getDevFiveMinutes` calls, 1 `getKpiStationDay` call, 8
 * ENTSO-E calls, none rate-limited, purely sequential latency). Dashboard/
 * Market's page routes have no `maxDuration` override, so an unbounded
 * import here would eventually exceed Vercel's function timeout and the
 * request would simply die mid-import.
 *
 * `timeBudgetMs` bounds how long this function will keep importing before
 * returning whatever it has, in-progress or not. This is *not* a
 * rate-limiting or backoff mechanism - production evidence found no
 * rate-limiting to react to - it is purely a wall-clock safety cap.
 * Days already imported are never re-fetched (same idempotent checks as
 * always), so if the budget runs out, the very next call - the next
 * page load, or the same one retried - picks up exactly where this one
 * left off, at zero cost for the days already done. This is the "resume
 * from the first missing day" behavior, driven by the budget rather than
 * by any rate-limit signal.
 */
export type HistoricalDayAvailability = {
  dateStr: string;
  /** `false` when `dateStr` resolves to today or the future — callers must not treat this as a historical-import result. */
  applicable: boolean;
  telemetryAvailable: boolean;
  dailyKpiAvailable: boolean;
  marketPriceAvailable: boolean;
  telemetryError: string | null;
  dailyKpiError: string | null;
  marketPriceError: string | null;
};

export type HistoricalRangeAvailability = {
  start: Date;
  end: Date;
  /**
   * True only once every applicable day in `[start, end)` has every
   * relevant piece available - `organizationId: null` (Market's
   * Trader-with-no-client view) only requires `marketPriceAvailable`,
   * since there is no plant for telemetry/daily-KPI to apply to.
   */
  fullyAvailable: boolean;
  days: HistoricalDayAvailability[];
};

const BULGARIA_TIMEZONE = "Europe/Sofia";

/**
 * Default wall-clock budget for one `ensureHistoricalRangeAvailable` call.
 *
 * Lowered from 45s (Browser Performance Validation milestone): the 45s
 * figure was calibrated against "a fully-missing WEEK took 67s" (see above),
 * not a much larger range with a genuine multi-month gap. Confirmed against
 * real production: this organization has zero telemetry for Jan-Apr 2026
 * (the plant wasn't connected yet) - a real-browser measurement of
 * `/dashboard?period=year` took 56.6s end-to-end (45s budget + ~11.6s of
 * this function's own non-budget page work), and `/market?period=year` -
 * which does strictly more per-request work on top - exceeded Vercel's
 * `maxDuration: 60` outright (confirmed timeout, not merely slow). 25s
 * leaves comfortable headroom under that 60s ceiling for both pages even
 * under this worst-case multi-month-gap scenario, at the cost of needing
 * more page loads to fully backfill a large historical gap from scratch -
 * an acceptable trade for a request that must always finish, per the
 * existing "resume from the first missing day" design this budget already
 * relies on (see this file's own module doc comment).
 */
const DEFAULT_TIME_BUDGET_MS = 25_000;

export type DayBounds = { start: Date; end: Date; dateStr: string };

/**
 * Every Bulgaria-local calendar day in `[rangeStart, rangeEnd)` that isn't
 * today or the future. Exported for the Platform Health & Operations Center
 * milestone (Section 13, Historical Coverage calendar) — the calendar view
 * reuses this exact day-enumeration + the `bulk*Days` read-only lookups
 * below rather than re-deriving its own, so "what counts as an applicable
 * historical day" stays defined in exactly one place.
 */
export function enumerateApplicableDays(rangeStart: Date, rangeEnd: Date): DayBounds[] {
  const days: DayBounds[] = [];
  const now = Date.now();
  let cursor = localDayBoundsUtc(rangeStart, BULGARIA_TIMEZONE);

  while (cursor.start.getTime() < rangeEnd.getTime()) {
    if (cursor.end.getTime() <= now) {
      days.push({
        start: cursor.start,
        end: cursor.end,
        dateStr: formatDateInZone(cursor.start, BULGARIA_TIMEZONE),
      });
    }
    cursor = localDayBoundsUtc(cursor.end, BULGARIA_TIMEZONE);
  }

  return days;
}

/**
 * Groups consecutive members of `days` matching `isMissing` into contiguous
 * `[start, end)` runs, so a bulk-capable importer (`importDeviceTelemetry`,
 * `importPlantDailyKpiRange`) can be called once per run instead of once per
 * missing day. `days` is always chronological with no gaps in the middle
 * (today/future exclusion only ever truncates the tail), so adjacency here
 * is a plain array-order check, not date arithmetic.
 */
function groupContiguousRuns(
  days: DayBounds[],
  isMissing: (day: DayBounds) => boolean,
): Array<{ start: Date; end: Date }> {
  const runs: Array<{ start: Date; end: Date }> = [];
  let runStart: Date | null = null;
  let runEnd: Date | null = null;

  for (const day of days) {
    if (isMissing(day)) {
      runStart ??= day.start;
      runEnd = day.end;
    } else if (runStart !== null) {
      runs.push({ start: runStart, end: runEnd as Date });
      runStart = null;
      runEnd = null;
    }
  }

  if (runStart !== null) {
    runs.push({ start: runStart, end: runEnd as Date });
  }

  return runs;
}

/**
 * Which Bulgaria-local calendar days already have at least one row —
 * exported for Section 13's read-only calendar view, see
 * `enumerateApplicableDays` above.
 *
 * Performance investigation (found via real production timing on a fully-
 * imported July: 38,358 rows -> 33.9s): this used to `findMany` every raw
 * row and call `localDayBoundsUtc` (4 `Intl.DateTimeFormat` constructions)
 * per row - 330,672 Intl calls for one month, confirmed the entire cost of
 * `ensureHistoricalRangeAvailable` for that range, with zero external
 * requests involved. `DISTINCT ... AT TIME ZONE` pushes the day-bucketing
 * into Postgres (correct DST handling via its own tzdata, same guarantee
 * `Intl.DateTimeFormat` gave), returning at most one row per calendar day in
 * range (≤366) instead of one per telemetry sample (tens of thousands) -
 * `localDayBoundsUtc` is now called once per distinct day, not once per row.
 * `to_char(...)` (not the raw `date` column) avoids any driver-specific
 * timezone-interpretation ambiguity for the returned value - same
 * `${dateStr}T12:00:00Z` convention `ensureHistoricalDayAvailable` already
 * uses elsewhere in this file.
 */
export async function bulkDeviceTelemetryDays(
  organizationId: string,
  start: Date,
  end: Date,
): Promise<Set<number>> {
  const rows = await prisma.$queryRaw<Array<{ local_date: string }>>`
    SELECT DISTINCT to_char(timestamp AT TIME ZONE 'Europe/Sofia', 'YYYY-MM-DD') AS local_date
    FROM "DeviceTelemetry"
    WHERE "organizationId" = ${organizationId} AND timestamp >= ${start} AND timestamp < ${end}
  `;
  return new Set(
    rows.map((row) => localDayBoundsUtc(new Date(`${row.local_date}T12:00:00Z`), BULGARIA_TIMEZONE).start.getTime()),
  );
}

/** Exported for Section 13's read-only calendar view — see `enumerateApplicableDays` above. */
export async function bulkPlantDailyKpiDays(organizationId: string, start: Date, end: Date): Promise<Set<number>> {
  const rows = await prisma.plantDailyKpi.findMany({
    where: { organizationId, localDate: { gte: start, lt: end } },
    select: { localDate: true },
  });
  return new Set(rows.map((row) => row.localDate.getTime()));
}

/** Same fix, same reasoning, as `bulkDeviceTelemetryDays` above - see its doc comment. */
export async function bulkMarketPriceDays(start: Date, end: Date): Promise<Set<number>> {
  const rows = await prisma.$queryRaw<Array<{ local_date: string }>>`
    SELECT DISTINCT to_char(timestamp AT TIME ZONE 'Europe/Sofia', 'YYYY-MM-DD') AS local_date
    FROM "MarketPrice"
    WHERE timestamp >= ${start} AND timestamp < ${end}
  `;
  return new Set(
    rows.map((row) => localDayBoundsUtc(new Date(`${row.local_date}T12:00:00Z`), BULGARIA_TIMEZONE).start.getTime()),
  );
}

/**
 * The real implementation. `organizationId: null` covers Market's
 * Trader-with-no-selected-client view (see `market/page.tsx`) —
 * `MarketPrice` is platform-wide and has no `organizationId` at all (per
 * its own schema), so ENTSO-E import still runs; there is simply no plant
 * to scope a `DeviceTelemetry`/`PlantDailyKpi` import to, so that half is
 * skipped for every day.
 */
export async function ensureHistoricalRangeAvailable(params: {
  organizationId: string | null;
  start: Date;
  end: Date;
  timeBudgetMs?: number;
}): Promise<HistoricalRangeAvailability> {
  const { organizationId, start, end, timeBudgetMs = DEFAULT_TIME_BUDGET_MS } = params;
  const startedAt = new Date();
  const days = enumerateApplicableDays(start, end);

  if (days.length === 0) {
    await recordImporterRun({
      importerType: IMPORTER_TYPE,
      organizationId,
      startedAt,
      status: "SKIPPED",
      details: { reason: "no_applicable_days" },
    });
    return { start, end, fullyAvailable: true, days: [] };
  }

  const deadline = Date.now() + timeBudgetMs;
  const hasTimeRemaining = () => Date.now() < deadline;

  const telemetryDays = organizationId !== null ? await bulkDeviceTelemetryDays(organizationId, start, end) : new Set<number>();
  const dailyKpiDays = organizationId !== null ? await bulkPlantDailyKpiDays(organizationId, start, end) : new Set<number>();
  const marketPriceDays = await bulkMarketPriceDays(start, end);

  // Performance investigation: if every applicable day is already fully
  // available, exit here - no connection lookup, no import attempt, no
  // "final recheck" bulk queries (which used to unconditionally re-run all
  // three bulk checks a second time even when nothing had been imported).
  // This is the literal "if range already complete, return immediately"
  // requirement - the range is genuinely already complete, so the upfront
  // check above IS the final answer; re-querying it a second time can only
  // ever reproduce the same result.
  const isFullyAvailableUpfront = days.every((day) =>
    organizationId === null
      ? marketPriceDays.has(day.start.getTime())
      : telemetryDays.has(day.start.getTime()) &&
        dailyKpiDays.has(day.start.getTime()) &&
        marketPriceDays.has(day.start.getTime()),
  );

  if (isFullyAvailableUpfront) {
    await recordImporterRun({
      importerType: IMPORTER_TYPE,
      organizationId,
      startedAt,
      status: "SKIPPED",
      rowsImported: days.length,
      details: { reason: "already_complete", daysRequested: days.length },
    });

    return {
      start,
      end,
      fullyAvailable: true,
      days: days.map((day) => ({
        dateStr: day.dateStr,
        applicable: true,
        telemetryAvailable: organizationId !== null,
        dailyKpiAvailable: organizationId !== null,
        marketPriceAvailable: true,
        telemetryError: null,
        dailyKpiError: null,
        marketPriceError: null,
      })),
    };
  }

  const telemetryErrorsByRun: Array<{ start: Date; end: Date; message: string }> = [];
  const dailyKpiErrorsByRun: Array<{ start: Date; end: Date; message: string }> = [];
  let marketPriceError: string | null = null;

  // Ordering matters here and is deliberate: cheap, bounded work first,
  // the one genuinely unbounded-by-range-size piece (telemetry - one
  // Huawei call per missing DAY, not per range) last. Confirmed against
  // production: a naive telemetry-first ordering starved daily-KPI and
  // market-price of any budget at all, on every retry, for a fully-missing
  // week - telemetry alone can consume the entire budget while the other
  // two (1 Huawei call regardless of range length; at most ~days+1 ENTSO-E
  // calls) would each have comfortably finished if given a turn at all.
  //
  // Root-cause fix (historical gap investigation): the SAME starvation can
  // happen in the other direction. Real production evidence for a
  // multi-month gap: individual ENTSO-E calls took 9.7-29s each (against a
  // 25s total budget), so market-price alone could consume the entire
  // remaining budget, leaving telemetry zero turns on every single request
  // - confirmed directly by probing Huawei for those exact "missing" days
  // (Jan/Feb/Apr 2026): Huawei returned full real data immediately
  // (2,000+ samples, zero errors) every time. These days were never
  // "unavailable" - they simply never got a chance to be requested. There
  // is no evidence from real Huawei/ENTSO-E responses of any day in this
  // range being permanently unavailable, so nothing here is marked as such;
  // the fix is fair scheduling, not a persisted "give up" flag. Market-price
  // now gets at most half of whatever budget remains after daily-KPI,
  // guaranteeing telemetry a real turn every request regardless of how slow
  // ENTSO-E is - the same reasoning as the telemetry-starvation fix above,
  // applied in reverse.
  let connection: FusionSolarConnection | null = null;
  let plants: Array<{ id: string }> = [];

  if (organizationId !== null) {
    const missingTelemetryDays = days.filter((day) => !telemetryDays.has(day.start.getTime()));
    const missingDailyKpiRuns = groupContiguousRuns(days, (day) => !dailyKpiDays.has(day.start.getTime()));

    if (missingTelemetryDays.length > 0 || missingDailyKpiRuns.length > 0) {
      connection = await prisma.fusionSolarConnection.findUnique({
        where: { organizationId_provider: { organizationId, provider: "HuaweiFusionSolar" } },
        select: {
          id: true,
          accessToken: true,
          refreshToken: true,
          tokenType: true,
          scope: true,
          expiresAt: true,
        },
      });

      if (connection) {
        plants = await prisma.plant.findMany({
          where: { organizationId, vendor: "Huawei" },
          select: { id: true },
        });

        // One call per contiguous run (not per day): `getKpiStationDay`
        // already fetches a whole calendar month per call, so this is
        // already bounded, cheap work - runs first, and to completion,
        // rather than risking starvation behind telemetry.
        for (const run of missingDailyKpiRuns) {
          if (!hasTimeRemaining()) {
            break;
          }

          try {
            await importPlantDailyKpiRange(organizationId, connection, { start: run.start, end: run.end });
          } catch (error) {
            dailyKpiErrorsByRun.push({
              start: run.start,
              end: run.end,
              message: error instanceof Error ? error.message : "unknown_error",
            });
          }
        }
      }
    }
  }

  if (hasTimeRemaining()) {
    const missingMarketPriceDays = days.filter((day) => !marketPriceDays.has(day.start.getTime()));
    if (missingMarketPriceDays.length > 0) {
      // Market-price gets at most half of whatever budget remains here, not
      // the full shared `deadline` - see the doc comment above this block
      // for the real production evidence (9.7-29s per ENTSO-E call) that
      // made this necessary.
      const marketPriceDeadline = Date.now() + Math.max(0, (deadline - Date.now()) / 2);

      try {
        const result = await ensureMarketPricesForBulgariaDays(
          missingMarketPriceDays.map((day) => day.start),
          marketPriceDeadline,
        );
        if (result.errors.length > 0) {
          marketPriceError = result.errors.join("; ");
        }
      } catch (error) {
        marketPriceError = error instanceof Error ? error.message : "unknown_error";
      }
    }
  }

  // Telemetry last, one day at a time (not one call per contiguous run) so
  // the time budget can be checked between days - `importDeviceTelemetry`
  // already makes exactly one Huawei call per day per device-type group
  // internally regardless of window size, so this changes nothing about
  // the number of real requests, only where the loop that makes them
  // lives (here, instead of inside that function) and when it's allowed
  // to run out of time.
  if (organizationId !== null && connection && hasTimeRemaining()) {
    const missingTelemetryDays = days.filter((day) => !telemetryDays.has(day.start.getTime()));

    for (const day of missingTelemetryDays) {
      if (!hasTimeRemaining()) {
        break;
      }

      try {
        for (const plant of plants) {
          await importDeviceTelemetry({
            connection,
            organizationId,
            plantId: plant.id,
            windowStart: day.start,
            windowEnd: day.end,
          });
        }
      } catch (error) {
        telemetryErrorsByRun.push({
          start: day.start,
          end: day.end,
          message: error instanceof Error ? error.message : "unknown_error",
        });
      }
    }
  }

  // Re-check everything in bulk once, after every import attempt above -
  // the accurate source of truth for the returned per-day availability,
  // independent of exactly which run/type reported an error.
  const finalTelemetryDays = organizationId !== null ? await bulkDeviceTelemetryDays(organizationId, start, end) : new Set<number>();
  const finalDailyKpiDays = organizationId !== null ? await bulkPlantDailyKpiDays(organizationId, start, end) : new Set<number>();
  const finalMarketPriceDays = await bulkMarketPriceDays(start, end);

  function errorForDay(
    day: DayBounds,
    errorsByRun: Array<{ start: Date; end: Date; message: string }>,
  ): string | null {
    const match = errorsByRun.find(
      (run) => day.start.getTime() >= run.start.getTime() && day.start.getTime() < run.end.getTime(),
    );
    return match?.message ?? null;
  }

  const result: HistoricalDayAvailability[] = days.map((day) => {
    const telemetryAvailable = organizationId !== null && finalTelemetryDays.has(day.start.getTime());
    const dailyKpiAvailable = organizationId !== null && finalDailyKpiDays.has(day.start.getTime());
    const marketPriceAvailable = finalMarketPriceDays.has(day.start.getTime());

    return {
      dateStr: day.dateStr,
      applicable: true,
      telemetryAvailable,
      dailyKpiAvailable,
      marketPriceAvailable,
      telemetryError: telemetryAvailable ? null : errorForDay(day, telemetryErrorsByRun),
      dailyKpiError: dailyKpiAvailable ? null : errorForDay(day, dailyKpiErrorsByRun),
      marketPriceError: marketPriceAvailable ? null : marketPriceError,
    };
  });

  const fullyAvailable = result.every((day) =>
    organizationId === null
      ? day.marketPriceAvailable
      : day.telemetryAvailable && day.dailyKpiAvailable && day.marketPriceAvailable,
  );

  const daysAvailable = result.filter((day) =>
    organizationId === null
      ? day.marketPriceAvailable
      : day.telemetryAvailable && day.dailyKpiAvailable && day.marketPriceAvailable,
  ).length;

  await recordImporterRun({
    importerType: IMPORTER_TYPE,
    organizationId,
    startedAt,
    status: fullyAvailable ? "SUCCESS" : "FAILED",
    rowsImported: daysAvailable,
    rowsFailed: result.length - daysAvailable,
    errorMessage: fullyAvailable
      ? undefined
      : "One or more days in the requested range could not be fully imported within the time budget",
    details: { daysRequested: result.length, daysAvailable },
  });

  return { start, end, fullyAvailable, days: result };
}

/**
 * Single-day convenience wrapper around `ensureHistoricalRangeAvailable` —
 * Dashboard/Market's existing per-day call sites use this exact shape.
 * `dateStr` resolving to today or the future returns the same
 * `applicable: false` placeholder it always has.
 */
export async function ensureHistoricalDayAvailable(params: {
  organizationId: string | null;
  dateStr: string;
}): Promise<HistoricalDayAvailability> {
  const { organizationId, dateStr } = params;
  const { start, end } = localDayBoundsUtc(new Date(`${dateStr}T12:00:00Z`), BULGARIA_TIMEZONE);

  const range = await ensureHistoricalRangeAvailable({ organizationId, start, end });

  return (
    range.days[0] ?? {
      dateStr,
      applicable: false,
      telemetryAvailable: false,
      dailyKpiAvailable: false,
      marketPriceAvailable: false,
      telemetryError: null,
      dailyKpiError: null,
      marketPriceError: null,
    }
  );
}
