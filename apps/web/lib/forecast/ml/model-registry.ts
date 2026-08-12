import { prisma } from "@/lib/prisma";
import type { ForecastModelVersion } from "@prisma/client";

/**
 * D+1 Self-Learning Forecast milestone — the model registry read/write
 * layer. `ForecastModelVersion` is the single source of truth for "what
 * model produced this forecast" — see that model's own doc comment in
 * `prisma/schema.prisma` for why the ONNX bytes live in Postgres rather
 * than a file path (this app's production runtime is stateless).
 *
 * Exactly one CHAMPION is expected globally at a time (not per-plant - the
 * global model IS the point, per this milestone's own explicit
 * requirement that plant identity be a continuous feature, not a reason
 * to fork the model). Not DB-enforced via a partial unique index (Prisma
 * doesn't support partial indexes portably) - enforced instead by
 * `promoteChallenger` always demoting the previous champion to RETIRED in
 * the same transaction as promoting the new one.
 */

export async function getCurrentChampion(): Promise<ForecastModelVersion | null> {
  return prisma.forecastModelVersion.findFirst({
    where: { status: "CHAMPION" },
    orderBy: { promotedAt: "desc" },
  });
}

export async function registerColdStartChampion(params: {
  versionLabel: string;
  family: "LIGHTGBM" | "XGBOOST";
  magnitudeModelOnnx: Buffer;
  shapeModelOnnx: Buffer;
  featureSchemaVersion: string;
  hyperparameters: unknown;
  trainingDataStart: Date;
  trainingDataEnd: Date;
  trainingSampleCount: number;
  trueVintageSampleCount: number;
  plantsCovered: string[];
  validationMetrics: unknown;
}): Promise<ForecastModelVersion> {
  const existingChampion = await getCurrentChampion();
  if (existingChampion) {
    throw new Error(
      `registerColdStartChampion called but a champion (${existingChampion.versionLabel}) already exists - use evaluateAndPromote instead for any subsequent model.`,
    );
  }

  return prisma.forecastModelVersion.create({
    data: {
      versionLabel: params.versionLabel,
      family: params.family,
      status: "CHAMPION",
      magnitudeModelOnnx: params.magnitudeModelOnnx,
      shapeModelOnnx: params.shapeModelOnnx,
      featureSchemaVersion: params.featureSchemaVersion,
      hyperparameters: params.hyperparameters as object,
      trainingDataStart: params.trainingDataStart,
      trainingDataEnd: params.trainingDataEnd,
      trainingSampleCount: params.trainingSampleCount,
      trueVintageSampleCount: params.trueVintageSampleCount,
      plantsCovered: params.plantsCovered,
      validationMetrics: params.validationMetrics as object,
      promotedAt: new Date(),
    },
  });
}
