import type { FusionSolarConnection } from "@/lib/fusionsolar/api-client";
import { importDeviceTelemetry } from "@/lib/fusionsolar/import-device-telemetry";
import { importPlantDailyKpiRange } from "@/lib/fusionsolar/import-plant-daily-kpi";
import { ensureMarketPricesForBulgariaDays } from "@/lib/market-price/refresh-market-prices";
import { prisma } from "@/lib/prisma";
import { recordImporterRun } from "@/lib/admin/importer-run";
import {
  bulkDeviceTelemetryDays,
  bulkMarketPriceDays,
  bulkPlantDailyKpiDays,
  enumerateApplicableDays,
  type DayBounds,
} from "@/lib/historical-data/ensure-day-available";

const IMPORTER_TYPE = "historical_range";

/**
 * Database-First Architecture milestone. The ONLY place in this application
 * that triggers a historical Huawei/ENTSO-E import. Called from exactly two
 * places: once automatically at onboarding
 * (`lib/onboarding/historical-import.ts`, a one-time backfill), and from
 * Platform Admin's explicit historical-import actions
 * (`app/admin/operations/historical-imports/actions.ts`). Dashboard/Market
 * never call this - they only ever read via
 * `checkHistoricalRangeAvailability` (`ensure-day-available.ts`).
 *
 * This is the same import logic that used to run on every Dashboard/Market
 * page load (`ensureHistoricalRangeAvailable`, removed) - checks first,
 * imports only what's missing, idempotent by construction (every importer
 * already upserts/skips-duplicates on its own unique key), bounded by a
 * wall-clock time budget so a huge or genuinely-gappy range can never run
 * past the caller's own function timeout. If the budget runs out, calling
 * this again for the same range resumes from exactly what's still missing,
 * at zero cost for whatever's already imported.
 */

/**
 * Groups consecutive members of `days` matching `isMissing` into contiguous
 * `[start, end)` runs, so a bulk-capable importer (`importDeviceTelemetry`,
 * `importPlantDailyKpiRange`) can be called once per run instead of once per
 * missing day.
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

export type HistoricalImportOutcome = {
  daysRequested: number;
  daysAvailable: number;
  fullyComplete: boolean;
  /** True if the time budget ran out before every day could be checked/imported - a retryable, expected state, not a failure. */
  timedOut: boolean;
};

/** Default wall-clock budget for one `importHistoricalRange` call, comfortably under a 60s function - callers with a longer `maxDuration` (onboarding, admin) should pass a larger explicit budget. */
const DEFAULT_TIME_BUDGET_MS = 25_000;

export async function importHistoricalRange(params: {
  organizationId: string;
  start: Date;
  end: Date;
  timeBudgetMs?: number;
}): Promise<HistoricalImportOutcome> {
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
    return { daysRequested: 0, daysAvailable: 0, fullyComplete: true, timedOut: false };
  }

  const deadline = Date.now() + timeBudgetMs;
  const hasTimeRemaining = () => Date.now() < deadline;

  const [telemetryDays, dailyKpiDays, marketPriceDays] = await Promise.all([
    bulkDeviceTelemetryDays(organizationId, start, end),
    bulkPlantDailyKpiDays(organizationId, start, end),
    bulkMarketPriceDays(start, end),
  ]);

  const isFullyAvailableUpfront = days.every(
    (day) =>
      telemetryDays.has(day.start.getTime()) &&
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
    return { daysRequested: days.length, daysAvailable: days.length, fullyComplete: true, timedOut: false };
  }

  const dailyKpiErrorsByRun: Array<{ start: Date; end: Date; message: string }> = [];

  // Ordering matters and is deliberate, confirmed against real production
  // evidence twice over (see docs/research or git history on this file's
  // predecessor for the full investigation): cheap/bounded work first
  // (daily-KPI - one call per contiguous run, already month-anchored), then
  // market-price capped to at most half of whatever budget remains (a
  // single ENTSO-E call was measured taking 9.7-29s - uncapped, it could
  // consume the entire budget and starve telemetry every single time), then
  // telemetry with whatever's left.
  const connection: FusionSolarConnection | null = await prisma.fusionSolarConnection.findUnique({
    where: { organizationId_provider: { organizationId, provider: "HuaweiFusionSolar" } },
    select: { id: true, accessToken: true, refreshToken: true, tokenType: true, scope: true, expiresAt: true },
  });

  if (connection) {
    const missingDailyKpiRuns = groupContiguousRuns(days, (day) => !dailyKpiDays.has(day.start.getTime()));

    for (const run of missingDailyKpiRuns) {
      if (!hasTimeRemaining()) break;

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

  if (hasTimeRemaining()) {
    const missingMarketPriceDays = days.filter((day) => !marketPriceDays.has(day.start.getTime()));
    if (missingMarketPriceDays.length > 0) {
      const marketPriceDeadline = Date.now() + Math.max(0, (deadline - Date.now()) / 2);
      await ensureMarketPricesForBulgariaDays(missingMarketPriceDays.map((day) => day.start), marketPriceDeadline).catch(
        () => undefined,
      );
    }
  }

  if (connection && hasTimeRemaining()) {
    const plants = await prisma.plant.findMany({ where: { organizationId, vendor: "Huawei" }, select: { id: true } });
    const missingTelemetryDays = days.filter((day) => !telemetryDays.has(day.start.getTime()));

    for (const day of missingTelemetryDays) {
      if (!hasTimeRemaining()) break;

      for (const plant of plants) {
        await importDeviceTelemetry({
          connection,
          organizationId,
          plantId: plant.id,
          windowStart: day.start,
          windowEnd: day.end,
        }).catch(() => undefined);
      }
    }
  }

  const [finalTelemetryDays, finalDailyKpiDays, finalMarketPriceDays] = await Promise.all([
    bulkDeviceTelemetryDays(organizationId, start, end),
    bulkPlantDailyKpiDays(organizationId, start, end),
    bulkMarketPriceDays(start, end),
  ]);

  const daysAvailable = days.filter(
    (day) =>
      finalTelemetryDays.has(day.start.getTime()) &&
      finalDailyKpiDays.has(day.start.getTime()) &&
      finalMarketPriceDays.has(day.start.getTime()),
  ).length;

  const fullyComplete = daysAvailable === days.length;
  const timedOut = !hasTimeRemaining() && !fullyComplete;

  await recordImporterRun({
    importerType: IMPORTER_TYPE,
    organizationId,
    startedAt,
    status: fullyComplete ? "SUCCESS" : "FAILED",
    rowsImported: daysAvailable,
    rowsFailed: days.length - daysAvailable,
    errorMessage: fullyComplete
      ? undefined
      : timedOut
        ? "Time budget exhausted before every day could be imported - resumable, retry to continue"
        : dailyKpiErrorsByRun.map((e) => e.message).join("; ") || "One or more days could not be imported",
    details: { daysRequested: days.length, daysAvailable, timedOut },
  });

  return { daysRequested: days.length, daysAvailable, fullyComplete, timedOut };
}
