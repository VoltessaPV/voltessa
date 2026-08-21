/**
 * Live Energy Forecast Integration milestone — forecast vintage
 * persistence and actual-vs-forecast reconciliation.
 *
 * `PvForecastRecord` rows are immutable once written except for
 * `actualKwh`/`errorKwh`/`errorPct`/`reconciledAt`, which are filled in
 * later once the target interval has elapsed and real data exists. This
 * is what lets later analysis answer "what did we predict at the time",
 * not "what would we predict now, knowing what actually happened."
 *
 * Dashboard Forecast Architecture Correction milestone: both functions
 * here are now called ONLY from the scheduled route
 * (`app/api/internal/forecast/refresh/route.ts`, a Scaleway systemd timer
 * firing twice daily — see `docs/infrastructure/scaleway-production.md`),
 * never from the Dashboard's own render path. Persisting a forecast is an
 * expensive operation (weather fetch, calibration lookback, analog-day
 * search, ~35 days x 96 intervals/day) — it belongs in a background job,
 * not a request handler. The Dashboard only ever *reads* the latest
 * already-persisted vintage (`lib/forecast/forecast-read.ts`).
 */
import { reconstructAvailablePv } from "@/lib/digital-twin/available-pv-reconstruction";
import { prisma } from "@/lib/prisma";
import type { PvForecastResult } from "@/lib/forecast/types";

const RECONCILE_LOOKBACK_DAYS = 3;
const RECONCILE_BATCH_LIMIT = 500;
const BUCKET_MS = 15 * 60 * 1000;
const NATIVE_SAMPLES_PER_BUCKET = 3;

/**
 * Persists one forecast vintage in full — every interval across every
 * horizon tier (SHORT/MEDIUM/LONG), not just the near-term SHORT portion:
 * unlike the old opportunistic-from-the-Dashboard design, the Dashboard no
 * longer computes a live forecast at all, so the persisted store must be
 * the complete source of truth for Today/Week/Month alike, at the same
 * 15-minute resolution the engine itself produces (display-time
 * aggregation to daily buckets happens in `dashboard-data.ts`, never here
 * — the persisted values themselves are never altered). Called once per
 * scheduled run (no throttling needed — the caller IS the schedule).
 * Returns the number of rows written, purely for the caller's own logging.
 */
export async function persistFullForecastVintage(params: {
  plantId: string;
  organizationId: string;
  forecast: PvForecastResult;
}): Promise<number> {
  const { plantId, organizationId, forecast } = params;
  const issuedAt = forecast.generatedAt;

  const rows = forecast.intervals.map((interval) => ({
    organizationId,
    plantId,
    issuedAt,
    targetIntervalStart: interval.timestamp,
    horizonTier: interval.horizonTier,
    leadTimeMinutes: Math.round((interval.timestamp.getTime() - issuedAt.getTime()) / 60_000),
    forecastKw: interval.forecastKw,
    forecastKwh: interval.forecastKwh,
    modelVersion: forecast.modelVersion,
    weatherSource: forecast.weatherSource,
    confidence: interval.confidence,
    inputs: {
      physicalWeatherKw: interval.components.physicalWeatherKw,
      calibrationFactor: interval.components.calibrationFactor,
      analogKw: interval.components.analogKw,
      analogWeight: interval.components.analogWeight,
      glidePathFactor: interval.components.glidePathFactor,
      capacityClipped: interval.capacityClipped,
      // Weather-horizon honesty fix (Aug 2026 Chomakovtsi investigation):
      // per-interval ground truth for what weather input actually backed
      // this forecast, and how much the historical-cloudiness-envelope
      // fallback moderated it — see `types.ts`'s `WeatherInputSource` and
      // `cloudiness-envelope.ts`. Persisted so a past vintage's own
      // assumptions stay inspectable after the fact, not just the tier
      // label.
      weatherInputSource: interval.components.weatherInputSource,
      historicalEnvelopeKwh: interval.components.historicalEnvelopeKwh,
      // D+1 learning-infrastructure milestone (Aug 2026): the exact raw weather inputs and
      // day-level regime available AT ISSUANCE - archived so a future training pass (or a
      // manual audit six weeks from now) can reconstruct "what did the system actually know
      // at generation time" without any contamination from weather observed after the fact.
      // Purely additive to this already-free-form Json blob; never read back into any
      // forecast-value computation (see pv-forecast-core.ts's own doc comment).
      ghiWm2: interval.components.ghiWm2,
      ambientTempC: interval.components.ambientTempC,
      cloudCoverPct: interval.components.cloudCoverPct,
      weatherRegime: interval.components.weatherRegime,
    },
  }));

  if (rows.length === 0) {
    return 0;
  }

  const result = await prisma.pvForecastRecord.createMany({ data: rows, skipDuplicates: true });
  return result.count;
}

/**
 * Reconciliation Backlog Determinism fix (Aug 2026). The `pending` query
 * below previously had no `orderBy` at all — with the backlog now
 * routinely in the thousands per plant (every target interval accumulates
 * one row per vintage that ever predicted it, confirmed: one production
 * day had 847 rows from 10 distinct vintages) and only
 * `RECONCILE_BATCH_LIMIT` (500) processed per run, an unordered query
 * gives Postgres no guarantee about WHICH 500 rows come back — in
 * production this meant several consecutive days going completely
 * unreconciled (0/96) for both plants despite fully valid underlying
 * telemetry, because the rows genuinely at risk of aging out of
 * `RECONCILE_LOOKBACK_DAYS` were never guaranteed to be the ones picked.
 *
 * Fix: order by `targetIntervalStart` ascending (oldest — i.e. closest to
 * falling out of the lookback window — first), with `id` as a
 * deterministic tie-breaker for the many rows that share the same target
 * interval (different vintages predicting the same real-world outcome —
 * order among those doesn't affect correctness, since they'll all resolve
 * to the identical `actualKwh`, but a stable tie-breaker keeps repeated
 * runs deterministic and testable). Confirmed via `EXPLAIN ANALYZE`
 * against production data that this ordering is served directly by the
 * EXISTING `@@index([plantId, targetIntervalStart])` index (an
 * "Index Scan" with only a cheap incremental sort for the `id`
 * tie-breaker among same-timestamp rows, 27kB working memory,
 * <1ms total) — no new index required, and `RECONCILE_BATCH_LIMIT` is
 * unchanged.
 */
const RECONCILE_ORDER_BY = [{ targetIntervalStart: "asc" as const }, { id: "asc" as const }];

export type PendingReconciliationRecord = {
  id: string;
  targetIntervalStart: Date;
  forecastKwh: number;
};

export type ReconciliationUpdate = {
  actualKwh: number;
  errorKwh: number;
  errorPct: number | null;
};

/**
 * Pure per-record reconciliation decision — extracted, unchanged math,
 * from what used to be inlined in the loop below, so it can be unit
 * tested without a database (this repo's Playwright suite has no test
 * database by design). `null` means "not yet fully settled, leave for a
 * later pass" — exactly the same three conditions as before (no bucket
 * for this exact target instant, a null actual sample seen, or fewer/more
 * than the expected 3 native 5-minute samples).
 */
export function computeReconciliationUpdate(
  record: PendingReconciliationRecord,
  actualByBucket: Map<number, { sum: number; count: number; nullSeen: boolean }>,
): ReconciliationUpdate | null {
  const bucket = actualByBucket.get(record.targetIntervalStart.getTime());
  if (!bucket || bucket.nullSeen || bucket.count !== NATIVE_SAMPLES_PER_BUCKET) {
    return null;
  }

  const actualKwh = Math.round(bucket.sum * 1000) / 1000;
  const errorKwh = Math.round((record.forecastKwh - actualKwh) * 1000) / 1000;
  const errorPct = actualKwh > 0 ? Math.round((errorKwh / actualKwh) * 1000 * 100) / 1000 : null;
  return { actualKwh, errorKwh, errorPct };
}

/**
 * Fills in `actualKwh`/`errorKwh`/`errorPct` for previously-stored vintages
 * whose target interval has now elapsed, using the exact same
 * `reconstructAvailablePv` (Zero-Export-independent) the forecast itself
 * is calibrated against — never historical export. Only considers
 * intervals fully settled (all 3 native 5-minute samples present, same
 * convention `pv-forecast-engine.ts`'s `bucketObservedToday` uses) —
 * anything not yet fully settled is left for a later reconciliation pass,
 * never estimated from a partial reading. Returns how many rows were
 * reconciled, purely for the caller's own diagnostics.
 */
export async function reconcileForecastActuals(params: {
  plantId: string;
  organizationId: string;
}): Promise<number> {
  const { plantId, organizationId } = params;
  const now = new Date();
  const lookbackStart = new Date(now.getTime() - RECONCILE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const pending = await prisma.pvForecastRecord
    .findMany({
      where: { plantId, actualKwh: null, targetIntervalStart: { lt: now, gte: lookbackStart } },
      select: { id: true, targetIntervalStart: true, forecastKwh: true },
      orderBy: RECONCILE_ORDER_BY,
      take: RECONCILE_BATCH_LIMIT,
    })
    .catch(() => []);

  if (pending.length === 0) {
    return 0;
  }

  const targetTimes = pending.map((row) => row.targetIntervalStart.getTime());
  const earliestTarget = new Date(Math.min(...targetTimes));
  const latestTarget = new Date(Math.max(...targetTimes) + BUCKET_MS);

  const actualIntervals = await reconstructAvailablePv({
    plantId,
    organizationId,
    start: earliestTarget,
    end: latestTarget,
  }).catch(() => []);

  const actualByBucket = new Map<number, { sum: number; count: number; nullSeen: boolean }>();
  for (const interval of actualIntervals) {
    const bucketStart = Math.floor(interval.intervalStart.getTime() / BUCKET_MS) * BUCKET_MS;
    const entry = actualByBucket.get(bucketStart) ?? { sum: 0, count: 0, nullSeen: false };
    if (interval.availablePvKwh === null) {
      entry.nullSeen = true;
    } else {
      entry.sum += interval.availablePvKwh;
      entry.count += 1;
    }
    actualByBucket.set(bucketStart, entry);
  }

  let reconciledCount = 0;

  for (const record of pending) {
    const update = computeReconciliationUpdate({ id: record.id, targetIntervalStart: record.targetIntervalStart, forecastKwh: record.forecastKwh.toNumber() }, actualByBucket);
    if (!update) {
      continue;
    }
    const { actualKwh, errorKwh, errorPct } = update;

    await prisma.pvForecastRecord
      .update({
        where: { id: record.id },
        data: { actualKwh, errorKwh, errorPct, reconciledAt: new Date() },
      })
      .catch(() => undefined);

    reconciledCount += 1;
  }

  return reconciledCount;
}

/**
 * Aggregate accuracy stats (item 11 of this milestone: MAE/RMSE/MAPE/
 * normalized error) — computed on demand directly from the reconciled
 * per-record errors already persisted above, rather than a separate
 * duplicated rollup table: the fine-grained data (forecast, actual, and
 * per-interval error) is what's genuinely worth persisting permanently;
 * an aggregate is cheap to re-derive from it at read time and never goes
 * stale relative to the underlying rows.
 */
export type ForecastAccuracyStats = {
  sampleCount: number;
  maeKwh: number | null;
  rmseKwh: number | null;
  mapePct: number | null;
  normalizedError: number | null;
  byHorizonTier: Partial<Record<"SHORT" | "MEDIUM" | "LONG", { sampleCount: number; maeKwh: number | null }>>;
};

export async function computeForecastAccuracyStats(params: {
  plantId: string;
  capacityKw: number;
  lookbackDays?: number;
}): Promise<ForecastAccuracyStats> {
  const { plantId, capacityKw, lookbackDays = 30 } = params;
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const records = await prisma.pvForecastRecord
    .findMany({
      where: { plantId, actualKwh: { not: null }, issuedAt: { gte: since } },
      select: { horizonTier: true, forecastKwh: true, actualKwh: true, errorKwh: true },
    })
    .catch(() => []);

  if (records.length === 0) {
    return { sampleCount: 0, maeKwh: null, rmseKwh: null, mapePct: null, normalizedError: null, byHorizonTier: {} };
  }

  const errors = records.map((r) => r.errorKwh?.toNumber() ?? 0);
  const absErrors = errors.map((e) => Math.abs(e));
  const sqErrors = errors.map((e) => e ** 2);
  const mae = absErrors.reduce((sum, v) => sum + v, 0) / absErrors.length;
  const rmse = Math.sqrt(sqErrors.reduce((sum, v) => sum + v, 0) / sqErrors.length);

  const mapeEligible = records.filter((r) => (r.actualKwh?.toNumber() ?? 0) > capacityKw * 0.25 * 0.05);
  const mape =
    mapeEligible.length > 0
      ? (mapeEligible.reduce((sum, r) => sum + Math.abs((r.errorKwh?.toNumber() ?? 0) / (r.actualKwh?.toNumber() ?? 1)), 0) /
          mapeEligible.length) *
        100
      : null;

  const byHorizonTier: ForecastAccuracyStats["byHorizonTier"] = {};
  for (const tier of ["SHORT", "MEDIUM", "LONG"] as const) {
    const tierRecords = records.filter((r) => r.horizonTier === tier);
    if (tierRecords.length === 0) continue;
    const tierAbsErrors = tierRecords.map((r) => Math.abs(r.errorKwh?.toNumber() ?? 0));
    byHorizonTier[tier] = {
      sampleCount: tierRecords.length,
      maeKwh: tierAbsErrors.reduce((sum, v) => sum + v, 0) / tierAbsErrors.length,
    };
  }

  return {
    sampleCount: records.length,
    maeKwh: mae,
    rmseKwh: rmse,
    mapePct: mape,
    normalizedError: capacityKw > 0 ? mae / (capacityKw * 0.25) : null,
    byHorizonTier,
  };
}
