import { test, expect } from "@playwright/test";

import { buildFeatureVector, buildDailyFeatureVector, FEATURE_NAMES, DAILY_FEATURE_NAMES } from "@/lib/forecast/ml/feature-schema";

/**
 * D+1 Self-Learning Forecast milestone. Leakage-prevention tests for the
 * feature builder, per this project's own explicit requirement: "the same
 * issuance timestamp and same inputs must deterministically produce the
 * same feature vector," and every feature must be answerable as "would
 * this value have genuinely been known at issuance?"
 *
 * These are structural tests of the pure builder functions themselves
 * (determinism, no hidden state, no `Date.now()`), not an end-to-end DB
 * leakage audit - the exporter's own chronological walk-forward loop
 * (`scripts/ml/export-training-dataset.ts`) is where the "recent-bias
 * history only contains strictly-earlier days" guarantee actually lives,
 * and is verified by inspection (see this project's own architecture
 * report) rather than duplicated as a second test suite here.
 */

function baseInput(overrides: Partial<Parameters<typeof buildFeatureVector>[0]> = {}) {
  return {
    timestamp: new Date("2026-08-13T10:00:00.000Z"),
    physicalWeatherKw: 80,
    capacityKw: 150,
    ghiWm2: 600,
    ambientTempC: 25,
    elevationDeg: 45,
    clearSkyIndex: 0.9,
    cloudCoverPct: 20,
    latitude: 42.89,
    longitude: 24.7,
    leadTimeMinutes: 600,
    weatherRegime: "CLEAR" as const,
    recentResidualKw: 2,
    ...overrides,
  };
}

test.describe("buildFeatureVector - determinism and leakage prevention", () => {
  test("identical input always produces an identical output vector (no hidden Date.now()/state dependency)", () => {
    const input = baseInput();
    const first = buildFeatureVector(input);
    const second = buildFeatureVector(input);
    expect(second).toEqual(first);
  });

  test("output vector length matches FEATURE_NAMES exactly - no silent drift between the schema and the builder", () => {
    const vector = buildFeatureVector(baseInput());
    expect(vector.length).toBe(FEATURE_NAMES.length);
  });

  test("cloudCoverPct=null (no real weather point at this instant) produces NaN, never a fabricated default", () => {
    const vector = buildFeatureVector(baseInput({ cloudCoverPct: null }));
    const cloudIndex = FEATURE_NAMES.indexOf("cloudCoverFrac");
    expect(Number.isNaN(vector[cloudIndex])).toBe(true);
  });

  test("a real cloudCoverPct value is never coerced to NaN", () => {
    const vector = buildFeatureVector(baseInput({ cloudCoverPct: 45 }));
    const cloudIndex = FEATURE_NAMES.indexOf("cloudCoverFrac");
    expect(vector[cloudIndex]).toBeCloseTo(0.45, 5);
  });

  test("plant identity is encoded via continuous capacity/lat/long, never a categorical plant-ID flag - a new plant needs no new feature column", () => {
    // Confirms structurally: FEATURE_NAMES contains no plant-ID-shaped entry (e.g. "plantIsAtlanta"),
    // only continuous characteristics - the exact design choice this milestone's own cold-start
    // requirement depends on (a brand-new plant's own real lat/long/capacity plug directly into
    // features the model already knows how to use).
    const hasPlantIdFlag = FEATURE_NAMES.some((name) => /plant.*is|plantId/i.test(name));
    expect(hasPlantIdFlag).toBe(false);
    expect(FEATURE_NAMES).toContain("latitudeNorm");
    expect(FEATURE_NAMES).toContain("longitudeNorm");
    expect(FEATURE_NAMES).toContain("capacityNorm");
  });

  test("weatherRegime is one-hot, mutually exclusive, and UNKNOWN is the correct implicit all-zero case", () => {
    const names: readonly string[] = FEATURE_NAMES;
    for (const regime of ["CLEAR", "PARTLY_CLOUDY", "CLOUDY", "RAPIDLY_CHANGING"] as const) {
      const vector = buildFeatureVector(baseInput({ weatherRegime: regime }));
      const regimeFlags = ["regimeIsClear", "regimeIsPartlyCloudy", "regimeIsCloudy", "regimeIsRapidlyChanging"].map((name) =>
        vector[names.indexOf(name)],
      );
      expect(regimeFlags.filter((v) => v === 1).length).toBe(1);
    }
    const unknownVector = buildFeatureVector(baseInput({ weatherRegime: "UNKNOWN" }));
    const unknownFlags = ["regimeIsClear", "regimeIsPartlyCloudy", "regimeIsCloudy", "regimeIsRapidlyChanging"].map(
      (name) => unknownVector[names.indexOf(name)],
    );
    expect(unknownFlags.every((v) => v === 0)).toBe(true);
  });

  test("night interval (elevationDeg <= 0) still produces a well-formed vector - the structural night-zero guarantee is enforced by the CALLER (ml-correction.ts), not by refusing to build a feature vector here", () => {
    const vector = buildFeatureVector(baseInput({ elevationDeg: -5, physicalWeatherKw: 0, clearSkyIndex: 0 }));
    expect(vector.length).toBe(FEATURE_NAMES.length);
    expect(vector.every((v) => Number.isFinite(v) || Number.isNaN(v))).toBe(true);
  });

  test("zero capacityKw never divides by zero (degrades to 0, never NaN/Infinity from the normalization itself)", () => {
    const vector = buildFeatureVector(baseInput({ capacityKw: 0, physicalWeatherKw: 0 }));
    const physKwNormIndex = FEATURE_NAMES.indexOf("physKwNorm");
    expect(vector[physKwNormIndex]).toBe(0);
  });

  test("Multi-Horizon milestone: horizon tier one-hot is mutually exclusive and matches classifyHorizonTier's own SHORT/MEDIUM/LONG boundaries - no separately-tuned threshold", () => {
    const names: readonly string[] = FEATURE_NAMES;
    const tierIndices = { short: names.indexOf("tierIsShort"), medium: names.indexOf("tierIsMedium"), long: names.indexOf("tierIsLong") };
    const cases: [number, "short" | "medium" | "long"][] = [
      [6 * 60, "short"], // 6h - well within SHORT (<=48h)
      [47 * 60, "short"], // just under the 48h boundary
      [49 * 60, "medium"], // just over the 48h boundary
      [5 * 24 * 60, "medium"], // 5 days - within MEDIUM (<=10 days)
      [11 * 24 * 60, "long"], // 11 days - over the 10-day MEDIUM/LONG boundary
      [30 * 24 * 60, "long"],
    ];
    for (const [leadTimeMinutes, expectedTier] of cases) {
      const vector = buildFeatureVector(baseInput({ leadTimeMinutes }));
      const flags = { short: vector[tierIndices.short], medium: vector[tierIndices.medium], long: vector[tierIndices.long] };
      expect(flags[expectedTier]).toBe(1);
      const others = (["short", "medium", "long"] as const).filter((t) => t !== expectedTier);
      for (const other of others) expect(flags[other]).toBe(0);
    }
  });
});

test.describe("buildDailyFeatureVector - determinism and leakage prevention", () => {
  function baseDailyInput(overrides: Partial<Parameters<typeof buildDailyFeatureVector>[0]> = {}) {
    return {
      date: new Date("2026-08-13T00:00:00.000Z"),
      physicalDailyKwh: 900,
      capacityKw: 150,
      meanGhiWm2: 400,
      meanCloudCoverPct: 20,
      latitude: 42.89,
      longitude: 24.7,
      weatherRegime: "CLEAR" as const,
      leadTimeMinutes: 24 * 60,
      recentResidualDailyKwh: 30,
      ...overrides,
    };
  }

  test("identical input always produces an identical output vector", () => {
    const input = baseDailyInput();
    expect(buildDailyFeatureVector(input)).toEqual(buildDailyFeatureVector(input));
  });

  test("output vector length matches DAILY_FEATURE_NAMES exactly", () => {
    expect(buildDailyFeatureVector(baseDailyInput()).length).toBe(DAILY_FEATURE_NAMES.length);
  });

  test("meanCloudCoverPct=null produces NaN, never a fabricated default", () => {
    const vector = buildDailyFeatureVector(baseDailyInput({ meanCloudCoverPct: null }));
    const index = DAILY_FEATURE_NAMES.indexOf("meanCloudFrac");
    expect(Number.isNaN(vector[index])).toBe(true);
  });
});
