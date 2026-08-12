import { readFileSync } from "node:fs";

import { prisma } from "@/lib/prisma";
import { registerColdStartChampion, getCurrentChampion } from "@/lib/forecast/ml/model-registry";

/**
 * D+1 Self-Learning Forecast milestone. Registers the model artifacts
 * `ml-forecasting/train.py` just produced as the first (cold-start)
 * CHAMPION — there is no existing ML champion to beat yet, per this
 * milestone's own explicit cold-start policy (§15 of the design). Every
 * SUBSEQUENT model version must go through `evaluateAndPromote` instead
 * (`lib/forecast/ml/promotion.ts`) and win the walk-forward gate.
 *
 * Reads `ml-forecasting/data/{model-manifest.json,magnitude_model.onnx,
 * shape_model.onnx}` - never re-trains, never re-derives metrics, purely
 * ingests what train.py already computed and validated.
 */

const DATA_DIR = "D:/Development/Voltessa/platform/ml-forecasting/data";

async function main() {
  const existing = await getCurrentChampion();
  if (existing) {
    console.log(`A champion already exists: ${existing.versionLabel} (${existing.family}), promoted ${existing.promotedAt?.toISOString()}.`);
    console.log("Not registering a cold-start champion - use the promotion pathway for a new model instead.");
    await prisma.$disconnect();
    return;
  }

  const manifest = JSON.parse(readFileSync(`${DATA_DIR}/model-manifest.json`, "utf-8"));
  const magnitudeModelOnnx = readFileSync(`${DATA_DIR}/magnitude_model.onnx`);
  const shapeModelOnnx = readFileSync(`${DATA_DIR}/shape_model.onnx`);

  const versionLabel = `${manifest.stage1Family.toLowerCase()}-${manifest.stage2Family.toLowerCase()}-${new Date().toISOString().slice(0, 10)}-coldstart`;

  const registered = await registerColdStartChampion({
    versionLabel,
    // The registry's own `family` field records the Stage 2 (shape) winner as the headline family,
    // since it's the one that runs 96x per forecast vs Stage 1's 1x - both winners are preserved
    // in full in `hyperparameters`/`validationMetrics` regardless.
    family: manifest.stage2Family,
    magnitudeModelOnnx,
    shapeModelOnnx,
    featureSchemaVersion: manifest.featureSchemaVersion,
    hyperparameters: { stage1Family: manifest.stage1Family, stage2Family: manifest.stage2Family, ...manifest.hyperparameters },
    trainingDataStart: new Date(manifest.trainingDataStart),
    trainingDataEnd: new Date(manifest.trainingDataEnd),
    trainingSampleCount: manifest.trainingSampleCount,
    trueVintageSampleCount: manifest.trueVintageSampleCount,
    plantsCovered: manifest.plantsCovered,
    validationMetrics: manifest.validationMetrics,
  });

  console.log(`Registered cold-start champion: ${registered.versionLabel} (id=${registered.id})`);
  console.log(`Trained on ${registered.trainingSampleCount} interval rows (${registered.trueVintageSampleCount} genuine D+1 vintage rows).`);
  console.log(`Plants covered: ${registered.plantsCovered.join(", ")}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
