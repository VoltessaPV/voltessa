import { test, expect } from "@playwright/test";

import { evaluateGate, type ValidationMetrics, type D1Metrics } from "@/lib/forecast/ml/promotion";

/**
 * D+1 Self-Learning Forecast milestone. Pure-function tests for the
 * champion/challenger promotion gate - per this project's own explicit
 * requirements: a challenger that wins on average but damages an
 * individual plant or weather regime must never be promoted, and "newer"
 * is never sufficient on its own.
 */

function metrics(overrides: Partial<D1Metrics> = {}): D1Metrics {
  return {
    intervalMaeKw: 5,
    intervalRmseKw: 10,
    biasKw: -1,
    dailyEnergyErrPctMean: 5,
    peakMaeKw: 10,
    nIntervalRows: 1000,
    nDays: 10,
    ...overrides,
  };
}

function baseValidation(overrides: Partial<ValidationMetrics> = {}): ValidationMetrics {
  return {
    combinedD1Holdout: metrics(),
    physicalBaselineHoldout: metrics({ intervalMaeKw: 8 }),
    perPlant: { plantA: { ml: metrics(), physicalOnly: metrics({ intervalMaeKw: 8 }) } },
    perWeatherRegime: { CLEAR: { ml: metrics(), physicalOnly: metrics({ intervalMaeKw: 8 }) } },
    ...overrides,
  };
}

test.describe("evaluateGate", () => {
  test("a candidate strictly better on every metric passes", () => {
    const champion = baseValidation();
    const candidate = baseValidation({ combinedD1Holdout: metrics({ intervalMaeKw: 4 }) });
    const result = evaluateGate(candidate, champion);
    expect(result.passed).toBe(true);
    expect(result.failedChecks).toEqual([]);
  });

  test("a candidate with strictly higher interval MAE always fails - the primary gate has zero tolerance", () => {
    const champion = baseValidation();
    const candidate = baseValidation({ combinedD1Holdout: metrics({ intervalMaeKw: 5.01 }) });
    const result = evaluateGate(candidate, champion);
    expect(result.passed).toBe(false);
    expect(result.failedChecks.some((c) => c.includes("interval MAE"))).toBe(true);
  });

  test("a candidate that improves pooled MAE but materially regresses ONE plant must NOT be promoted", () => {
    const champion = baseValidation({
      perPlant: {
        plantA: { ml: metrics({ intervalMaeKw: 5 }), physicalOnly: metrics() },
        plantB: { ml: metrics({ intervalMaeKw: 5 }), physicalOnly: metrics() },
      },
    });
    // Pooled improves (4.0 vs 5.0) but plantB alone regresses materially (5 -> 7, +40%).
    const candidate = baseValidation({
      combinedD1Holdout: metrics({ intervalMaeKw: 4.0 }),
      perPlant: {
        plantA: { ml: metrics({ intervalMaeKw: 1 }), physicalOnly: metrics() },
        plantB: { ml: metrics({ intervalMaeKw: 7 }), physicalOnly: metrics() },
      },
    });
    const result = evaluateGate(candidate, champion);
    expect(result.passed).toBe(false);
    expect(result.failedChecks.some((c) => c.includes("plantB"))).toBe(true);
  });

  test("a candidate that improves pooled MAE but materially regresses ONE weather regime must NOT be promoted", () => {
    const champion = baseValidation({
      perWeatherRegime: {
        CLEAR: { ml: metrics({ intervalMaeKw: 3 }), physicalOnly: metrics() },
        CLOUDY: { ml: metrics({ intervalMaeKw: 8 }), physicalOnly: metrics() },
      },
    });
    const candidate = baseValidation({
      combinedD1Holdout: metrics({ intervalMaeKw: 4.0 }),
      perWeatherRegime: {
        CLEAR: { ml: metrics({ intervalMaeKw: 0.5 }), physicalOnly: metrics() },
        CLOUDY: { ml: metrics({ intervalMaeKw: 12 }), physicalOnly: metrics() }, // 8 -> 12, +50%
      },
    });
    const result = evaluateGate(candidate, champion);
    expect(result.passed).toBe(false);
    expect(result.failedChecks.some((c) => c.includes("CLOUDY"))).toBe(true);
  });

  test("a small (<=10%) regression on a secondary metric is tolerated, not treated as material", () => {
    const champion = baseValidation();
    const candidate = baseValidation({
      combinedD1Holdout: metrics({ intervalMaeKw: 5, intervalRmseKw: 10.5 }), // +5%, within tolerance
    });
    const result = evaluateGate(candidate, champion);
    expect(result.passed).toBe(true);
  });

  test("a >10% regression on a secondary metric (RMSE) fails even when primary MAE improves", () => {
    const champion = baseValidation();
    const candidate = baseValidation({
      combinedD1Holdout: metrics({ intervalMaeKw: 4, intervalRmseKw: 12 }), // MAE improves, RMSE +20%
    });
    const result = evaluateGate(candidate, champion);
    expect(result.passed).toBe(false);
    expect(result.failedChecks.some((c) => c.includes("RMSE"))).toBe(true);
  });

  test("a genuinely new plant with no champion baseline is never penalized for lacking history", () => {
    const champion = baseValidation({ perPlant: { plantA: { ml: metrics(), physicalOnly: metrics() } } });
    const candidate = baseValidation({
      combinedD1Holdout: metrics({ intervalMaeKw: 4 }),
      perPlant: {
        plantA: { ml: metrics({ intervalMaeKw: 4 }), physicalOnly: metrics() },
        plantC_new: { ml: metrics({ intervalMaeKw: 20 }), physicalOnly: metrics({ intervalMaeKw: 25 }) },
      },
    });
    const result = evaluateGate(candidate, champion);
    expect(result.passed).toBe(true);
  });

  test("bias regression is measured on absolute value - a sign flip of similar magnitude is not penalized, but a magnitude increase is", () => {
    const champion = baseValidation({ combinedD1Holdout: metrics({ biasKw: -1 }) });
    const flippedSimilarMagnitude = baseValidation({ combinedD1Holdout: metrics({ biasKw: 1 }) });
    expect(evaluateGate(flippedSimilarMagnitude, champion).passed).toBe(true);

    const magnitudeIncrease = baseValidation({ combinedD1Holdout: metrics({ biasKw: -2 }) }); // |−2| > |−1| * 1.1
    expect(evaluateGate(magnitudeIncrease, champion).passed).toBe(false);
  });

  test("deterministic: identical inputs always produce identical results", () => {
    const champion = baseValidation();
    const candidate = baseValidation({ combinedD1Holdout: metrics({ intervalMaeKw: 4 }) });
    expect(evaluateGate(candidate, champion)).toEqual(evaluateGate(candidate, champion));
  });
});
