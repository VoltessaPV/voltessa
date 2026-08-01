import { importDeviceTelemetry } from "@/lib/fusionsolar/import-device-telemetry";
import { importPlantDailyKpiRange } from "@/lib/fusionsolar/import-plant-daily-kpi";
import { ensureMarketPricesForBulgariaDays } from "@/lib/market-price/refresh-market-prices";
import { formatDateInZone, localDayBoundsUtc } from "@/lib/market-price/timezone";
import { prisma } from "@/lib/prisma";

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

type DayBounds = { start: Date; end: Date; dateStr: string };

/** Every Bulgaria-local calendar day in `[rangeStart, rangeEnd)` that isn't today or the future. */
function enumerateApplicableDays(rangeStart: Date, rangeEnd: Date): DayBounds[] {
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

async function bulkDeviceTelemetryDays(
  organizationId: string,
  start: Date,
  end: Date,
): Promise<Set<number>> {
  const rows = await prisma.deviceTelemetry.findMany({
    where: { organizationId, timestamp: { gte: start, lt: end } },
    select: { timestamp: true },
  });
  return new Set(rows.map((row) => localDayBoundsUtc(row.timestamp, BULGARIA_TIMEZONE).start.getTime()));
}

async function bulkPlantDailyKpiDays(organizationId: string, start: Date, end: Date): Promise<Set<number>> {
  const rows = await prisma.plantDailyKpi.findMany({
    where: { organizationId, localDate: { gte: start, lt: end } },
    select: { localDate: true },
  });
  return new Set(rows.map((row) => row.localDate.getTime()));
}

async function bulkMarketPriceDays(start: Date, end: Date): Promise<Set<number>> {
  const rows = await prisma.marketPrice.findMany({
    where: { timestamp: { gte: start, lt: end } },
    select: { timestamp: true },
  });
  return new Set(rows.map((row) => localDayBoundsUtc(row.timestamp, BULGARIA_TIMEZONE).start.getTime()));
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
}): Promise<HistoricalRangeAvailability> {
  const { organizationId, start, end } = params;
  const days = enumerateApplicableDays(start, end);

  if (days.length === 0) {
    return { start, end, fullyAvailable: true, days: [] };
  }

  const telemetryDays = organizationId !== null ? await bulkDeviceTelemetryDays(organizationId, start, end) : new Set<number>();
  const dailyKpiDays = organizationId !== null ? await bulkPlantDailyKpiDays(organizationId, start, end) : new Set<number>();
  const marketPriceDays = await bulkMarketPriceDays(start, end);

  const telemetryErrorsByRun: Array<{ start: Date; end: Date; message: string }> = [];
  const dailyKpiErrorsByRun: Array<{ start: Date; end: Date; message: string }> = [];
  let marketPriceError: string | null = null;

  if (organizationId !== null) {
    const missingTelemetryRuns = groupContiguousRuns(days, (day) => !telemetryDays.has(day.start.getTime()));
    const missingDailyKpiRuns = groupContiguousRuns(days, (day) => !dailyKpiDays.has(day.start.getTime()));

    if (missingTelemetryRuns.length > 0 || missingDailyKpiRuns.length > 0) {
      const connection = await prisma.fusionSolarConnection.findUnique({
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
        const plants = await prisma.plant.findMany({
          where: { organizationId, vendor: "Huawei" },
          select: { id: true },
        });

        for (const run of missingTelemetryRuns) {
          try {
            for (const plant of plants) {
              await importDeviceTelemetry({
                connection,
                organizationId,
                plantId: plant.id,
                windowStart: run.start,
                windowEnd: run.end,
              });
            }
          } catch (error) {
            telemetryErrorsByRun.push({
              start: run.start,
              end: run.end,
              message: error instanceof Error ? error.message : "unknown_error",
            });
          }
        }

        for (const run of missingDailyKpiRuns) {
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

  const missingMarketPriceDays = days.filter((day) => !marketPriceDays.has(day.start.getTime()));
  if (missingMarketPriceDays.length > 0) {
    try {
      const result = await ensureMarketPricesForBulgariaDays(missingMarketPriceDays.map((day) => day.start));
      if (result.errors.length > 0) {
        marketPriceError = result.errors.join("; ");
      }
    } catch (error) {
      marketPriceError = error instanceof Error ? error.message : "unknown_error";
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
