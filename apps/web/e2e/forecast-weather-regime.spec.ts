import { test, expect } from "@playwright/test";

import { classifyWeatherRegime } from "@/lib/forecast/forecast-tiers";

/**
 * D+1 learning-infrastructure milestone (Aug 2026). Pure-function tests for
 * `classifyWeatherRegime` — see that function's own doc comment for why its
 * thresholds reuse `classifyConfidence`'s existing `cloudVolatility >= 30`
 * boundary and this session's own clear-sky-validation 20/50 mean-cloud
 * buckets, rather than inventing new ones.
 */

test.describe("classifyWeatherRegime", () => {
  test("no real weather (null mean cloud cover) is honestly UNKNOWN, never guessed", () => {
    expect(classifyWeatherRegime({ meanCloudCoverPct: null, cloudVolatility: null })).toBe("UNKNOWN");
  });

  test("low mean cloud cover, low volatility -> CLEAR", () => {
    expect(classifyWeatherRegime({ meanCloudCoverPct: 5, cloudVolatility: 3 })).toBe("CLEAR");
  });

  test("moderate mean cloud cover -> PARTLY_CLOUDY", () => {
    expect(classifyWeatherRegime({ meanCloudCoverPct: 35, cloudVolatility: 10 })).toBe("PARTLY_CLOUDY");
  });

  test("high mean cloud cover -> CLOUDY", () => {
    expect(classifyWeatherRegime({ meanCloudCoverPct: 80, cloudVolatility: 10 })).toBe("CLOUDY");
  });

  test("high volatility overrides a low/moderate mean into RAPIDLY_CHANGING", () => {
    // Mean cloud cover alone (15%) would read as CLEAR, but a day that swings
    // wildly (e.g. 0% to 80%) is not the same predictable regime as a
    // uniformly clear day - volatility must win.
    expect(classifyWeatherRegime({ meanCloudCoverPct: 15, cloudVolatility: 35 })).toBe("RAPIDLY_CHANGING");
  });

  test("boundary: exactly 30 volatility counts as rapidly changing (>=, not >)", () => {
    expect(classifyWeatherRegime({ meanCloudCoverPct: 10, cloudVolatility: 30 })).toBe("RAPIDLY_CHANGING");
  });

  test("boundary: mean cloud cover exactly at 20/50 falls into the next bucket up (< not <=)", () => {
    expect(classifyWeatherRegime({ meanCloudCoverPct: 20, cloudVolatility: 5 })).toBe("PARTLY_CLOUDY");
    expect(classifyWeatherRegime({ meanCloudCoverPct: 50, cloudVolatility: 5 })).toBe("CLOUDY");
  });

  test("deterministic: identical input always produces identical output", () => {
    const input = { meanCloudCoverPct: 42, cloudVolatility: 12 };
    const first = classifyWeatherRegime(input);
    const second = classifyWeatherRegime(input);
    expect(first).toBe(second);
  });
});
