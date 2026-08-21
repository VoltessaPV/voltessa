import { prisma } from "@/lib/prisma";
import { findGenuineVintageDays, MIN_NEW_VINTAGE_DAYS_TO_RETRAIN, shouldRetrain } from "@/lib/forecast/ml/genuine-vintage";

/**
 * D+1 Self-Learning Forecast milestone. Read-only aggregation for the
 * `/admin/ml-forecast` monitoring page — per this milestone's own explicit
 * requirement, this must be answerable without reading source code: is
 * the system learning, what does the current champion know, and what has
 * it actually forecast recently.
 *
 * Continuous Retraining Loop milestone: extended with two read-only views
 * over data that already exists — (1) live trailing-window accuracy from
 * already-reconciled `MlForecastRecord.errorKwh` (the same field that
 * caught the Chomakovtsi MEDIUM-tier bias-sign-flip during investigation),
 * and (2) retraining eligibility, using the EXACT SAME `findGenuineVintageDays`/
 * `shouldRetrain` functions `scripts/ml/retrain-and-promote.ts` itself
 * uses to decide whether to run — so this page always shows the real
 * decision the next scheduled run will make, never a second, drifting
 * definition of "eligible."
 */

const LIVE_ACCURACY_WINDOW_DAYS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export type MlForecastOverview = {
  champion: {
    id: string;
    versionLabel: string;
    family: string;
    featureSchemaVersion: string;
    trainingDataStart: Date;
    trainingDataEnd: Date;
    trainingSampleCount: number;
    trueVintageSampleCount: number;
    plantsCovered: string[];
    promotedAt: Date | null;
    validationMetrics: unknown;
    /** Multi-Horizon milestone: read out of `validationMetrics.trueVintageSampleCountByTier`/`trainingSampleCountByTier` - see `lib/forecast/ml/promotion.ts`'s `ValidationMetrics` type. Undefined for pre-multi-horizon champions. */
    trueVintageSampleCountByTier: Record<string, number> | undefined;
    trainingSampleCountByTier: Record<string, number> | undefined;
  } | null;
  modelHistory: {
    id: string;
    versionLabel: string;
    family: string;
    status: string;
    createdAt: Date;
    promotedAt: Date | null;
    rejectedAt: Date | null;
    rejectionReason: string | null;
  }[];
  recentForecastsByPlant: {
    plantId: string;
    plantName: string;
    latestIssuedAt: Date | null;
    intervalCount: number;
    dailyTotalKwh: number | null;
    peakKw: number | null;
    weatherRegime: string | null;
    reconciledCount: number;
    pendingCount: number;
  }[];
  /** Live, trailing-window accuracy from already-reconciled MlForecastRecord rows - independent of (and more recent than) the champion's own training-time holdout metrics above. `null` mean values when a (plant, tier) cell has zero reconciled samples in the window - never a fabricated 0. */
  liveAccuracy: {
    windowDays: number;
    rows: {
      plantId: string;
      plantName: string;
      horizonTier: string;
      sampleCount: number;
      meanBiasKwh: number | null;
      meanAbsErrorKwh: number | null;
    }[];
  };
  /** Retraining eligibility, computed with the EXACT SAME logic `scripts/ml/retrain-and-promote.ts` uses - this is a preview of what the next scheduled run will decide, not a separate opinion. */
  retrainEligibility: {
    minNewVintageDaysRequired: number;
    sinceDate: string | null;
    perPlant: { plantId: string; plantName: string; newGenuineVintageDays: number }[];
    totalNewGenuineVintageDays: number;
    eligible: boolean;
  };
};

export async function getMlForecastOverview(): Promise<MlForecastOverview> {
  const [champion, modelHistory, plants] = await Promise.all([
    prisma.forecastModelVersion.findFirst({ where: { status: "CHAMPION" }, orderBy: { promotedAt: "desc" } }),
    prisma.forecastModelVersion.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, versionLabel: true, family: true, status: true, createdAt: true, promotedAt: true, rejectedAt: true, rejectionReason: true },
      take: 20,
    }),
    prisma.plant.findMany({ where: { mlForecastRecords: { some: {} } }, select: { id: true, name: true } }),
  ]);

  const recentForecastsByPlant = await Promise.all(
    plants.map(async (plant) => {
      const latest = await prisma.mlForecastRecord.findFirst({
        where: { plantId: plant.id },
        orderBy: { issuedAt: "desc" },
        select: { issuedAt: true },
      });
      if (!latest) {
        return { plantId: plant.id, plantName: plant.name, latestIssuedAt: null, intervalCount: 0, dailyTotalKwh: null, peakKw: null, weatherRegime: null, reconciledCount: 0, pendingCount: 0 };
      }

      const rows = await prisma.mlForecastRecord.findMany({
        where: { plantId: plant.id, issuedAt: latest.issuedAt },
        select: { mlForecastKw: true, mlForecastKwh: true, weatherRegime: true, actualKwh: true },
      });

      const dailyTotalKwh = rows.reduce((sum, r) => sum + r.mlForecastKwh.toNumber(), 0);
      const peakKw = rows.length > 0 ? Math.max(...rows.map((r) => r.mlForecastKw.toNumber())) : null;
      const reconciledCount = rows.filter((r) => r.actualKwh !== null).length;

      return {
        plantId: plant.id,
        plantName: plant.name,
        latestIssuedAt: latest.issuedAt,
        intervalCount: rows.length,
        dailyTotalKwh,
        peakKw,
        weatherRegime: rows[0]?.weatherRegime ?? null,
        reconciledCount,
        pendingCount: rows.length - reconciledCount,
      };
    }),
  );

  const championMetrics = champion?.validationMetrics as
    | { trueVintageSampleCountByTier?: Record<string, number>; trainingSampleCountByTier?: Record<string, number> }
    | null
    | undefined;

  // --- Live, trailing-window accuracy — same reconciled MlForecastRecord data, grouped fresh. ---
  const liveAccuracySince = new Date(Date.now() - LIVE_ACCURACY_WINDOW_DAYS * DAY_MS);
  const reconciledRecent = await prisma.mlForecastRecord.findMany({
    where: { actualKwh: { not: null }, targetIntervalStart: { gte: liveAccuracySince } },
    select: { plantId: true, horizonTier: true, mlForecastKwh: true, actualKwh: true },
  });
  const plantNameById = new Map(plants.map((p) => [p.id, p.name]));
  const liveAccuracyGroups = new Map<string, { plantId: string; horizonTier: string; biasSum: number; absErrSum: number; count: number }>();
  for (const row of reconciledRecent) {
    const key = `${row.plantId}::${row.horizonTier}`;
    const forecastKwh = row.mlForecastKwh.toNumber();
    const actualKwh = row.actualKwh!.toNumber();
    const group = liveAccuracyGroups.get(key) ?? { plantId: row.plantId, horizonTier: row.horizonTier, biasSum: 0, absErrSum: 0, count: 0 };
    group.biasSum += forecastKwh - actualKwh;
    group.absErrSum += Math.abs(forecastKwh - actualKwh);
    group.count += 1;
    liveAccuracyGroups.set(key, group);
  }
  const liveAccuracyRows = [...liveAccuracyGroups.values()]
    .map((g) => ({
      plantId: g.plantId,
      plantName: plantNameById.get(g.plantId) ?? g.plantId,
      horizonTier: g.horizonTier,
      sampleCount: g.count,
      meanBiasKwh: g.count > 0 ? Math.round((g.biasSum / g.count) * 1000) / 1000 : null,
      meanAbsErrorKwh: g.count > 0 ? Math.round((g.absErrSum / g.count) * 1000) / 1000 : null,
    }))
    .sort((a, b) => a.plantName.localeCompare(b.plantName) || a.horizonTier.localeCompare(b.horizonTier));

  // --- Retraining eligibility — the EXACT SAME check scripts/ml/retrain-and-promote.ts runs. ---
  const eligiblePlants = await prisma.plant.findMany({
    where: { latitude: { not: null }, longitude: { not: null }, capacityKw: { not: null } },
    select: { id: true, name: true },
  });
  let retrainEligibility: MlForecastOverview["retrainEligibility"];
  if (!champion) {
    retrainEligibility = { minNewVintageDaysRequired: MIN_NEW_VINTAGE_DAYS_TO_RETRAIN, sinceDate: null, perPlant: [], totalNewGenuineVintageDays: 0, eligible: false };
  } else {
    const since = new Date(champion.trainingDataEnd.getTime() + DAY_MS);
    const until = new Date();
    const perPlant = await Promise.all(
      eligiblePlants.map(async (plant) => ({
        plantId: plant.id,
        plantName: plant.name,
        newGenuineVintageDays: (await findGenuineVintageDays(plant.id, since, until)).length,
      })),
    );
    const totalNewGenuineVintageDays = perPlant.reduce((sum, p) => sum + p.newGenuineVintageDays, 0);
    retrainEligibility = {
      minNewVintageDaysRequired: MIN_NEW_VINTAGE_DAYS_TO_RETRAIN,
      sinceDate: since.toISOString().slice(0, 10),
      perPlant,
      totalNewGenuineVintageDays,
      eligible: shouldRetrain(perPlant.map((p) => p.newGenuineVintageDays)),
    };
  }

  return {
    champion: champion
      ? {
          id: champion.id,
          versionLabel: champion.versionLabel,
          family: champion.family,
          featureSchemaVersion: champion.featureSchemaVersion,
          trainingDataStart: champion.trainingDataStart,
          trainingDataEnd: champion.trainingDataEnd,
          trainingSampleCount: champion.trainingSampleCount,
          trueVintageSampleCount: champion.trueVintageSampleCount,
          plantsCovered: champion.plantsCovered,
          promotedAt: champion.promotedAt,
          validationMetrics: champion.validationMetrics,
          trueVintageSampleCountByTier: championMetrics?.trueVintageSampleCountByTier,
          trainingSampleCountByTier: championMetrics?.trainingSampleCountByTier,
        }
      : null,
    modelHistory,
    recentForecastsByPlant,
    liveAccuracy: { windowDays: LIVE_ACCURACY_WINDOW_DAYS, rows: liveAccuracyRows },
    retrainEligibility,
  };
}
