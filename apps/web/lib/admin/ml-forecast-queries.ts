import { prisma } from "@/lib/prisma";

/**
 * D+1 Self-Learning Forecast milestone. Read-only aggregation for the
 * `/admin/ml-forecast` monitoring page — per this milestone's own explicit
 * requirement, this must be answerable without reading source code: is
 * the system learning, what does the current champion know, and what has
 * it actually forecast recently.
 */

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
  };
}
