import { formatDateInZone, localDayBoundsUtc } from "@/lib/market-price/timezone";
import { prisma } from "@/lib/prisma";

/**
 * Database-First Architecture milestone. Pure, read-only historical-data
 * availability checks — Dashboard/Market call `checkHistoricalRangeAvailability`
 * to find out whether a requested period already exists locally. Nothing in
 * this file ever calls Huawei or ENTSO-E, and nothing in this file writes
 * anything — Voltessa's own database (`PlantDailyKpi`/`DeviceTelemetry`/
 * `MarketPrice`) is the only source these functions read from.
 *
 * Historical imports are a completely separate concern now — see
 * `lib/historical-data/import-historical-range.ts`, called only from
 * onboarding (once, automatically) and Platform Admin's historical-import
 * tools (`app/admin/operations/historical-imports`). Page rendering must
 * never trigger, retry, or wait on an import; if a requested period isn't
 * here, the page shows "historical data is not available" and returns
 * immediately — see `dashboard/page.tsx` / `market/page.tsx`.
 *
 * (Previously this file also owned the import orchestration itself —
 * `ensureHistoricalRangeAvailable` checked availability and attempted to
 * backfill whatever was missing, called on every Dashboard/Market request.
 * That architecture was replaced: production evidence during that design
 * showed unpredictable, sometimes very slow, Huawei/ENTSO-E latency turning
 * ordinary page loads into multi-second-to-multi-minute waits. Database
 * reads are fast and bounded; external APIs are not — so external APIs no
 * longer participate in rendering at all.)
 */

export type HistoricalDayAvailability = {
  dateStr: string;
  /** `false` when `dateStr` resolves to today or the future — callers must not treat this as a historical-data result. */
  applicable: boolean;
  telemetryAvailable: boolean;
  dailyKpiAvailable: boolean;
  marketPriceAvailable: boolean;
};

export type HistoricalRangeAvailability = {
  start: Date;
  end: Date;
  /**
   * True only once every applicable day in `[start, end)` has every
   * relevant piece available locally - `organizationId: null` (Market's
   * Trader-with-no-client view) only requires `marketPriceAvailable`,
   * since there is no plant for telemetry/daily-KPI to apply to.
   */
  fullyAvailable: boolean;
  days: HistoricalDayAvailability[];
};

const BULGARIA_TIMEZONE = "Europe/Sofia";

export type DayBounds = { start: Date; end: Date; dateStr: string };

/**
 * Every Bulgaria-local calendar day in `[rangeStart, rangeEnd)` that isn't
 * today or the future. Shared by the availability check below, the Platform
 * Health & Operations Center's historical-coverage calendar, and the
 * historical importer - "what counts as an applicable historical day" stays
 * defined in exactly one place.
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
 * Which Bulgaria-local calendar days already have at least one row —
 * `DISTINCT ... AT TIME ZONE` pushes day-bucketing into Postgres (correct
 * DST handling via its own tzdata) instead of calling the
 * `Intl.DateTimeFormat`-based `localDayBoundsUtc` once per raw telemetry
 * row - confirmed in production this is the difference between ~150ms and
 * ~34s for a month of 5-minute telemetry. `to_char(...)` (not the raw
 * `date` column) avoids any driver-specific timezone-interpretation
 * ambiguity for the returned value.
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

/** `PlantDailyKpi.localDate` is already a UTC-midnight-Bulgaria instant, so no per-row timezone bucketing is needed here. */
export async function bulkPlantDailyKpiDays(organizationId: string, start: Date, end: Date): Promise<Set<number>> {
  const rows = await prisma.plantDailyKpi.findMany({
    where: { organizationId, localDate: { gte: start, lt: end } },
    select: { localDate: true },
  });
  return new Set(rows.map((row) => row.localDate.getTime()));
}

/** Same technique as `bulkDeviceTelemetryDays` above - see its doc comment. */
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
 * The one function Dashboard/Market call to decide what to render for a
 * historical (or partially historical) period - three bulk, indexed reads,
 * nothing else. `organizationId: null` covers Market's Trader-with-no-
 * selected-client view (see `market/page.tsx`) — `MarketPrice` is
 * platform-wide and has no `organizationId` at all (per its own schema).
 */
export async function checkHistoricalRangeAvailability(params: {
  organizationId: string | null;
  start: Date;
  end: Date;
}): Promise<HistoricalRangeAvailability> {
  const { organizationId, start, end } = params;
  const days = enumerateApplicableDays(start, end);

  if (days.length === 0) {
    return { start, end, fullyAvailable: true, days: [] };
  }

  const [telemetryDays, dailyKpiDays, marketPriceDays] = await Promise.all([
    organizationId !== null ? bulkDeviceTelemetryDays(organizationId, start, end) : Promise.resolve(new Set<number>()),
    organizationId !== null ? bulkPlantDailyKpiDays(organizationId, start, end) : Promise.resolve(new Set<number>()),
    bulkMarketPriceDays(start, end),
  ]);

  const result: HistoricalDayAvailability[] = days.map((day) => ({
    dateStr: day.dateStr,
    applicable: true,
    telemetryAvailable: organizationId !== null && telemetryDays.has(day.start.getTime()),
    dailyKpiAvailable: organizationId !== null && dailyKpiDays.has(day.start.getTime()),
    marketPriceAvailable: marketPriceDays.has(day.start.getTime()),
  }));

  const fullyAvailable = result.every((day) =>
    organizationId === null
      ? day.marketPriceAvailable
      : day.telemetryAvailable && day.dailyKpiAvailable && day.marketPriceAvailable,
  );

  return { start, end, fullyAvailable, days: result };
}
