import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { prisma } from "@/lib/prisma";
import { getCurrentChampion, registerCandidate } from "@/lib/forecast/ml/model-registry";
import { evaluateAndPromote } from "@/lib/forecast/ml/promotion";
import { findGenuineVintageDays, shouldRetrain, MIN_NEW_VINTAGE_DAYS_TO_RETRAIN } from "@/lib/forecast/ml/genuine-vintage";

/**
 * Continuous Retraining Loop milestone (Aug 2026). The single orchestration
 * entry point for automatic retraining — chains four steps, THREE of which
 * are pre-existing, unmodified code (per this milestone's own explicit
 * "do not redesign" instruction):
 *
 *   1. Eligibility check (NEW, this file + `genuine-vintage.ts`) — is there
 *      enough genuinely new evidence since the current champion's own
 *      training window to justify retraining at all? If not: log and exit
 *      0, WITHOUT running the exporter, WITHOUT invoking Python, WITHOUT
 *      creating any `ForecastModelVersion` row. A quiet week never forces
 *      a meaningless retrain.
 *   2. Export (EXISTING, `export-training-dataset.ts` — now fixed to use
 *      the correct per-interval TRUE_VINTAGE definition).
 *   3. Train (EXISTING, `ml-forecasting/train.py`, unmodified) — CPU-only,
 *      walk-forward validated, writes ONNX + a manifest.
 *   4. Register as CANDIDATE (NEW: `registerCandidate`, mirrors
 *      `registerColdStartChampion`'s own shape) then `evaluateAndPromote`
 *      (EXISTING, `lib/forecast/ml/promotion.ts`, unmodified) — promotes
 *      ONLY if every gate check passes; otherwise the candidate is marked
 *      REJECTED with its reason and the current champion is untouched.
 *
 * A training run can NEVER become champion by merely completing —
 * `evaluateAndPromote` is the sole path to CHAMPION status, exactly as it
 * already was for a human running `register-champion.ts` manually.
 *
 * LOCAL/MANUAL reference implementation only. The production
 * `voltessa-ml-retrain.timer` (see `docs/infrastructure/scaleway-production.md`)
 * does NOT run this script directly — the Scaleway VM's limited disk
 * cannot safely host this app's full pnpm/Prisma dependency tree
 * alongside `train.py`'s own Python ML libraries. In production, the same
 * four steps run as: `app/api/internal/forecast/ml-retrain-export/route.ts`
 * (steps 1–2, on Vercel, which already has this app's full dependency
 * tree) → `train.py` (step 3, on the VM, the one piece that must run off
 * Vercel) → `app/api/internal/forecast/ml-retrain-promote/route.ts`
 * (step 4, back on Vercel). Every one of those four steps calls the exact
 * same underlying functions this script does — `buildTrainingDataset`,
 * `train.py` unmodified, `registerCandidate`, `evaluateAndPromote` — this
 * script exists so the whole loop can still be run and understood as one
 * unit locally, e.g. for a manual dry run against a local `DATABASE_URL`.
 * Safe to invoke manually; idempotent per eligibility check (a second run
 * against the same data simply finds nothing new and exits).
 */

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(scriptDir, "../../../..");
const ML_DIR = path.join(REPO_ROOT, "ml-forecasting");
const DATA_DIR = path.join(ML_DIR, "data");
const PYTHON_BIN = process.env.ML_RETRAIN_PYTHON_BIN ?? "python3";
const DAY_MS = 24 * 60 * 60 * 1000;

async function main() {
  const champion = await getCurrentChampion();
  if (!champion) {
    console.log(
      "[retrain-and-promote] No champion exists yet - this is the cold-start case, handled by scripts/ml/register-champion.ts, not this script. Nothing to do.",
    );
    await prisma.$disconnect();
    return;
  }

  console.log(`[retrain-and-promote] Current champion: ${champion.versionLabel} (trainingDataEnd=${champion.trainingDataEnd.toISOString().slice(0, 10)})`);

  const plants = await prisma.plant.findMany({
    where: { latitude: { not: null }, longitude: { not: null }, capacityKw: { not: null } },
    select: { id: true, name: true },
  });

  // Strictly AFTER the day the current champion's own training window ends -
  // never re-count a day it already learned from.
  const since = new Date(champion.trainingDataEnd.getTime() + DAY_MS);
  const until = new Date();

  const newDayCountsByPlant: number[] = [];
  for (const plant of plants) {
    const days = await findGenuineVintageDays(plant.id, since, until);
    newDayCountsByPlant.push(days.length);
    console.log(`[retrain-and-promote]   ${plant.name}: ${days.length} new genuine vintage day(s) since ${since.toISOString().slice(0, 10)}`);
  }

  const totalNewDays = newDayCountsByPlant.reduce((s, n) => s + n, 0);

  if (!shouldRetrain(newDayCountsByPlant)) {
    console.log(
      `[retrain-and-promote] Only ${totalNewDays} new genuine vintage day(s) across all plants combined - below the minimum of ${MIN_NEW_VINTAGE_DAYS_TO_RETRAIN}. Skipping retraining. No candidate created, no training run started.`,
    );
    await prisma.$disconnect();
    return;
  }

  console.log(`[retrain-and-promote] ${totalNewDays} new genuine vintage day(s) available - proceeding with retraining.`);

  console.log("[retrain-and-promote] Step 1/3: exporting the full walk-forward training dataset...");
  execFileSync("pnpm", ["tsx", "--tsconfig", "apps/web/tsconfig.json", "apps/web/scripts/ml/export-training-dataset.ts"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: process.env,
  });

  console.log(`[retrain-and-promote] Step 2/3: training (${PYTHON_BIN} train.py)...`);
  execFileSync(PYTHON_BIN, ["train.py"], { cwd: ML_DIR, stdio: "inherit", env: process.env });

  const manifestPath = path.join(DATA_DIR, "model-manifest.json");
  const magnitudePath = path.join(DATA_DIR, "magnitude_model.onnx");
  const shapePath = path.join(DATA_DIR, "shape_model.onnx");
  if (!existsSync(manifestPath) || !existsSync(magnitudePath) || !existsSync(shapePath)) {
    throw new Error("[retrain-and-promote] train.py did not produce the expected artifacts - aborting before registering anything.");
  }

  console.log("[retrain-and-promote] Step 3/3: registering candidate and evaluating the promotion gate...");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const magnitudeModelOnnx = readFileSync(magnitudePath);
  const shapeModelOnnx = readFileSync(shapePath);
  const versionLabel = `${manifest.stage1Family.toLowerCase()}-${manifest.stage2Family.toLowerCase()}-${new Date().toISOString().slice(0, 10)}-retrain`;

  const candidate = await registerCandidate({
    versionLabel,
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
  console.log(`[retrain-and-promote] Registered candidate ${candidate.versionLabel} (id=${candidate.id}, trueVintageSampleCount=${candidate.trueVintageSampleCount}).`);

  const gate = await evaluateAndPromote(candidate.id);
  if (gate.passed) {
    console.log(`[retrain-and-promote] Candidate PROMOTED to champion.`);
  } else {
    console.log(`[retrain-and-promote] Candidate REJECTED - champion unchanged (${champion.versionLabel}). Reasons: ${gate.failedChecks.join("; ")}`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[retrain-and-promote] FAILED", err);
  await prisma.$disconnect();
  process.exit(1);
});
