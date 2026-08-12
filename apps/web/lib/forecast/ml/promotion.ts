import { prisma } from "@/lib/prisma";
import { getCurrentChampion } from "@/lib/forecast/ml/model-registry";

/**
 * D+1 Self-Learning Forecast milestone — the champion/challenger
 * promotion gate. `evaluateGate` is a pure function (no I/O, fully unit-
 * testable) so the exact promotion decision for any pair of metric sets
 * can be verified deterministically; `evaluateAndPromote` is the thin DB-
 * effecting wrapper a scheduled retrain job calls.
 *
 * Every threshold below is the SAME acceptance-gate design already
 * specified (and reused, not re-derived) across this project's own D+1
 * architecture audits this session: lower-or-equal interval MAE, no
 * material bias/peak/energy degradation, no material regression on any
 * individual plant or weather regime. "Material" is a fixed 10% relative
 * tolerance on the secondary metrics (not the primary MAE gate, which
 * must not regress at all) - not tuned per candidate, not adjustable per
 * run, so a challenger can never pass by getting the threshold changed
 * out from under it.
 */

const MATERIAL_REGRESSION_TOLERANCE = 0.1; // 10% relative

export type D1Metrics = {
  intervalMaeKw: number;
  intervalRmseKw: number;
  biasKw: number;
  dailyEnergyErrPctMean: number | null;
  peakMaeKw: number | null;
  nIntervalRows: number;
  nDays: number;
};

export type ValidationMetrics = {
  combinedD1Holdout: D1Metrics;
  physicalBaselineHoldout: D1Metrics;
  perPlant: Record<string, { ml: D1Metrics; physicalOnly: D1Metrics }>;
  perWeatherRegime: Record<string, { ml: D1Metrics; physicalOnly: D1Metrics }>;
  /** Multi-Horizon milestone: SHORT/MEDIUM/LONG breakdown of the same holdout - optional so older, pre-multi-horizon model versions remain a valid shape. */
  perHorizonTier?: Record<string, { ml: D1Metrics; physicalOnly: D1Metrics }>;
  /** Multi-Horizon milestone: per-tier sample counts for cold-start/maturity display - see `lib/admin/ml-forecast-queries.ts`. Optional for the same reason as `perHorizonTier`. */
  trueVintageSampleCountByTier?: Record<string, number>;
  trainingSampleCountByTier?: Record<string, number>;
};

export type GateResult = {
  passed: boolean;
  failedChecks: string[];
};

function materiallyWorse(candidate: number, baseline: number): boolean {
  if (baseline === 0) return candidate > 0;
  return candidate > baseline * (1 + MATERIAL_REGRESSION_TOLERANCE);
}

/**
 * Pure gate evaluation: does `candidate` beat `champion` per this
 * project's own objective acceptance criteria? Never promotes on
 * "newer is better" alone - every check must independently pass.
 */
export function evaluateGate(candidate: ValidationMetrics, champion: ValidationMetrics): GateResult {
  const failedChecks: string[] = [];

  // 1. Primary gate: interval MAE must be lower or equal - no tolerance, this is the headline metric.
  if (candidate.combinedD1Holdout.intervalMaeKw > champion.combinedD1Holdout.intervalMaeKw) {
    failedChecks.push(
      `interval MAE regressed: candidate=${candidate.combinedD1Holdout.intervalMaeKw.toFixed(3)}kW > champion=${champion.combinedD1Holdout.intervalMaeKw.toFixed(3)}kW`,
    );
  }

  // 2. RMSE must not materially degrade.
  if (materiallyWorse(candidate.combinedD1Holdout.intervalRmseKw, champion.combinedD1Holdout.intervalRmseKw)) {
    failedChecks.push(`RMSE materially worse: candidate=${candidate.combinedD1Holdout.intervalRmseKw.toFixed(3)} champion=${champion.combinedD1Holdout.intervalRmseKw.toFixed(3)}`);
  }

  // 3. Bias must not materially worsen (compare absolute value - a swing from +1 to -1 kW is still a regression).
  if (materiallyWorse(Math.abs(candidate.combinedD1Holdout.biasKw), Math.abs(champion.combinedD1Holdout.biasKw))) {
    failedChecks.push(`bias materially worse: candidate=${candidate.combinedD1Holdout.biasKw.toFixed(3)}kW champion=${champion.combinedD1Holdout.biasKw.toFixed(3)}kW`);
  }

  // 4. Peak MAE must not materially degrade.
  if (
    candidate.combinedD1Holdout.peakMaeKw !== null &&
    champion.combinedD1Holdout.peakMaeKw !== null &&
    materiallyWorse(candidate.combinedD1Holdout.peakMaeKw, champion.combinedD1Holdout.peakMaeKw)
  ) {
    failedChecks.push(`peak MAE materially worse: candidate=${candidate.combinedD1Holdout.peakMaeKw.toFixed(2)}kW champion=${champion.combinedD1Holdout.peakMaeKw.toFixed(2)}kW`);
  }

  // 5. Daily energy error must not materially degrade.
  if (
    candidate.combinedD1Holdout.dailyEnergyErrPctMean !== null &&
    champion.combinedD1Holdout.dailyEnergyErrPctMean !== null &&
    materiallyWorse(candidate.combinedD1Holdout.dailyEnergyErrPctMean, champion.combinedD1Holdout.dailyEnergyErrPctMean)
  ) {
    failedChecks.push(
      `daily energy error materially worse: candidate=${candidate.combinedD1Holdout.dailyEnergyErrPctMean.toFixed(2)}% champion=${champion.combinedD1Holdout.dailyEnergyErrPctMean.toFixed(2)}%`,
    );
  }

  // 6. No individual plant may materially regress, even if the pooled average improves -
  //    an improvement in one plant must never be allowed to hide damage in another.
  for (const [plantId, candidatePlant] of Object.entries(candidate.perPlant)) {
    const championPlant = champion.perPlant[plantId];
    if (!championPlant) continue; // a genuinely new plant has no champion baseline to compare against yet
    if (materiallyWorse(candidatePlant.ml.intervalMaeKw, championPlant.ml.intervalMaeKw)) {
      failedChecks.push(`plant ${plantId} regressed: candidate MAE=${candidatePlant.ml.intervalMaeKw.toFixed(3)}kW champion MAE=${championPlant.ml.intervalMaeKw.toFixed(3)}kW`);
    }
  }

  // 7. No individual weather regime may materially regress - clear-weather accuracy specifically
  //    must never be traded away for a cloudy-weather improvement, or vice versa.
  for (const [regime, candidateRegime] of Object.entries(candidate.perWeatherRegime)) {
    const championRegime = champion.perWeatherRegime[regime];
    if (!championRegime) continue;
    if (materiallyWorse(candidateRegime.ml.intervalMaeKw, championRegime.ml.intervalMaeKw)) {
      failedChecks.push(`regime ${regime} regressed: candidate MAE=${candidateRegime.ml.intervalMaeKw.toFixed(3)}kW champion MAE=${championRegime.ml.intervalMaeKw.toFixed(3)}kW`);
    }
  }

  // 8. Multi-Horizon milestone: no individual horizon tier may materially regress - D+1's own
  //    accuracy must never be traded away to buy a MEDIUM/LONG-horizon improvement, and vice
  //    versa. Missing on either side (older, pre-multi-horizon model versions) skips this check
  //    rather than failing on a shape mismatch.
  if (candidate.perHorizonTier && champion.perHorizonTier) {
    for (const [tier, candidateTier] of Object.entries(candidate.perHorizonTier)) {
      const championTier = champion.perHorizonTier[tier];
      if (!championTier) continue;
      if (materiallyWorse(candidateTier.ml.intervalMaeKw, championTier.ml.intervalMaeKw)) {
        failedChecks.push(`horizon tier ${tier} regressed: candidate MAE=${candidateTier.ml.intervalMaeKw.toFixed(3)}kW champion MAE=${championTier.ml.intervalMaeKw.toFixed(3)}kW`);
      }
    }
  }

  return { passed: failedChecks.length === 0, failedChecks };
}

/**
 * DB-effecting wrapper: fetches the current champion's own stored
 * `validationMetrics`, evaluates the gate, and either promotes the
 * candidate (demoting the previous champion to RETIRED in the same
 * transaction) or marks it REJECTED with the exact reason - never a
 * silent no-op either way.
 */
export async function evaluateAndPromote(candidateModelVersionId: string): Promise<GateResult> {
  const [candidate, champion] = await Promise.all([
    prisma.forecastModelVersion.findUniqueOrThrow({ where: { id: candidateModelVersionId } }),
    getCurrentChampion(),
  ]);

  if (!champion) {
    throw new Error("evaluateAndPromote called with no existing champion - use registerColdStartChampion for the first model instead.");
  }

  const gate = evaluateGate(candidate.validationMetrics as unknown as ValidationMetrics, champion.validationMetrics as unknown as ValidationMetrics);

  if (gate.passed) {
    await prisma.$transaction([
      prisma.forecastModelVersion.update({ where: { id: champion.id }, data: { status: "RETIRED" } }),
      prisma.forecastModelVersion.update({ where: { id: candidate.id }, data: { status: "CHAMPION", promotedAt: new Date() } }),
    ]);
  } else {
    await prisma.forecastModelVersion.update({
      where: { id: candidate.id },
      data: { status: "REJECTED", rejectedAt: new Date(), rejectionReason: gate.failedChecks.join("; ") },
    });
  }

  return gate;
}
