import { prisma } from "@/lib/prisma";
import { reconstructAvailablePv } from "@/lib/digital-twin/available-pv-reconstruction";
import { generateMlForecast, type MlForecastInterval } from "@/lib/forecast/ml/ml-correction";

/**
 * Multi-Horizon Self-Learning Forecast milestone — persistence for the ML
 * pipeline's own, separate forecast table. Mirrors `forecast-persistence.ts`'s
 * `persistFullForecastVintage`/`reconcileForecastActuals` shape
 * deliberately (same reconciliation contract, same
 * Zero-Export-independent actual source), but writes to `MlForecastRecord`
 * — never `PvForecastRecord` — so the existing physical+hand-tuned
 * production pipeline stays completely untouched by this milestone.
 */

const RECONCILE_LOOKBACK_DAYS = 3;
const RECONCILE_BATCH_LIMIT = 500;
const BUCKET_MS = 15 * 60 * 1000;
const NATIVE_SAMPLES_PER_BUCKET = 3;

export async function persistMlForecast(params: {
  plantId: string;
  organizationId: string;
  latitude: number;
  longitude: number;
  capacityKw: number;
  issuedAt: Date;
  horizonDays?: number;
}): Promise<{ persistedCount: number; modelVersionId: string } | null> {
  const result = await generateMlForecast(params);
  if (!result) return null;

  const rows = result.intervals.map((interval: MlForecastInterval) => ({
    organizationId: params.organizationId,
    plantId: params.plantId,
    modelVersionId: result.modelVersionId,
    issuedAt: params.issuedAt,
    targetIntervalStart: interval.timestamp,
    leadTimeMinutes: Math.round(interval.leadTimeMinutes),
    horizonTier: interval.horizonTier,
    physicalForecastKw: interval.physicalForecastKw,
    mlForecastKw: interval.mlForecastKw,
    mlForecastKwh: interval.mlForecastKwh,
    weatherRegime: interval.weatherRegime,
    featureVector: interval.featureVector,
  }));

  if (rows.length === 0) return { persistedCount: 0, modelVersionId: result.modelVersionId };

  const created = await prisma.mlForecastRecord.createMany({ data: rows, skipDuplicates: true });
  return { persistedCount: created.count, modelVersionId: result.modelVersionId };
}

export async function reconcileMlForecastActuals(params: { plantId: string; organizationId: string }): Promise<number> {
  const { plantId, organizationId } = params;
  const now = new Date();
  const lookbackStart = new Date(now.getTime() - RECONCILE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const pending = await prisma.mlForecastRecord
    .findMany({
      where: { plantId, actualKwh: null, targetIntervalStart: { lt: now, gte: lookbackStart } },
      select: { id: true, targetIntervalStart: true },
      take: RECONCILE_BATCH_LIMIT,
    })
    .catch(() => []);

  if (pending.length === 0) return 0;

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
    const bucket = actualByBucket.get(record.targetIntervalStart.getTime());
    if (!bucket || bucket.nullSeen || bucket.count !== NATIVE_SAMPLES_PER_BUCKET) continue;

    const actualKwh = Math.round(bucket.sum * 1000) / 1000;

    const full = await prisma.mlForecastRecord.findUnique({ where: { id: record.id }, select: { mlForecastKwh: true } });
    if (!full) continue;
    const forecastKwh = full.mlForecastKwh.toNumber();
    const errorKwh = Math.round((forecastKwh - actualKwh) * 1000) / 1000;
    const errorPct = actualKwh > 0 ? Math.round((errorKwh / actualKwh) * 1000 * 100) / 1000 : null;

    await prisma.mlForecastRecord
      .update({ where: { id: record.id }, data: { actualKwh, errorKwh, errorPct, reconciledAt: new Date() } })
      .catch(() => undefined);

    reconciledCount += 1;
  }

  return reconciledCount;
}
