import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

import { prisma } from "@/lib/prisma";
import { buildTrainingDataset } from "@/lib/forecast/ml/build-training-dataset";

/**
 * Multi-Horizon Self-Learning Forecast milestone. Thin local/manual
 * wrapper — the actual dataset-building logic (walk-forward TRUE_VINTAGE/
 * RETROSPECTIVE_REPLAY selection, the three simulated lead-time scenarios,
 * leakage-safe feature building) now lives in
 * `lib/forecast/ml/build-training-dataset.ts` (Continuous Retraining Loop
 * milestone extraction), shared with
 * `app/api/internal/forecast/ml-retrain-export/route.ts` — the production
 * retraining path. Run this script directly only for a local/manual
 * `train.py` run against `ml-forecasting/data/training-dataset.json`.
 */

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(scriptDir, "../../../../ml-forecasting/data/training-dataset.json");

async function main() {
  const dataset = await buildTrainingDataset();

  writeFileSync(outPath, JSON.stringify(dataset));
  console.log(`Exported ${dataset.intervalRows.length} interval rows (${JSON.stringify(dataset.tierRowCounts)}), ${dataset.dailyRows.length} daily rows.`);
  console.log(`True vintage days: ${dataset.trueVintageDays}, retrospective replay days: ${dataset.replayDays}.`);
  console.log(`Written to ${outPath}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
