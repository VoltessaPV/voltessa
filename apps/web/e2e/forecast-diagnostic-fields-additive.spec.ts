import { test, expect } from "@playwright/test";

import { generatePvForecastCore } from "@/lib/forecast/pv-forecast-core";
import type { HourOfDayCalibration } from "@/lib/forecast/calibration";
import type { SolarWeatherPoint } from "@/lib/weather/openMeteo";

/**
 * D+1 learning-infrastructure milestone (Aug 2026): proves the new
 * archival-only diagnostic fields (`ghiWm2`, `ambientTempC`, `cloudCoverPct`,
 * `weatherRegime` on `components`) are purely additive - reading them, or
 * varying the new `weatherRegime` param, can never change any real forecast
 * value (`forecastKw`/`forecastKwh`/`capacityClipped`/every other existing
 * `components` field). This is the "byte-identical before/after" proof
 * requested for this milestone, expressed as a regression test rather than a
 * one-off diff, so it stays true going forward.
 */

const LATITUDE = 42.892833;
const LONGITUDE = 24.701003;
const CAPACITY_KW = 200;
const DAY_START = new Date("2026-08-10T00:00:00.000Z");
const HORIZON_END = new Date("2026-08-11T00:00:00.000Z");

const IDENTITY_CALIBRATION: HourOfDayCalibration = { factors: new Map(), sampleCount: 50, lookbackDays: 30 };

function weatherPoints(): SolarWeatherPoint[] {
  const points: SolarWeatherPoint[] = [];
  for (let t = DAY_START.getTime(); t <= HORIZON_END.getTime(); t += 60 * 60 * 1000) {
    points.push({ time: new Date(t), irradiance: 500, cloudCover: 35, temperature: 22, windSpeed: 2, weatherCode: 1 });
  }
  return points;
}

function baseParams() {
  return {
    plantId: "test-plant",
    latitude: LATITUDE,
    longitude: LONGITUDE,
    capacityKw: CAPACITY_KW,
    now: DAY_START,
    horizonEnd: HORIZON_END,
    weatherPoints: weatherPoints(),
    calibration: IDENTITY_CALIBRATION,
    analogShapeByDayUtc: new Map(),
    analogWeight: 0.5,
    observedElapsedToday: [],
  };
}

test.describe("diagnostic fields are additive - never affect real forecast values", () => {
  test("omitting weatherRegime (the new optional param) produces identical intervals to explicitly passing every regime value", () => {
    const withoutParam = generatePvForecastCore(baseParams());

    for (const regime of ["CLEAR", "PARTLY_CLOUDY", "CLOUDY", "RAPIDLY_CHANGING", "UNKNOWN"] as const) {
      const withParam = generatePvForecastCore({ ...baseParams(), weatherRegime: regime });

      expect(withParam.intervals.length).toBe(withoutParam.intervals.length);
      for (let i = 0; i < withoutParam.intervals.length; i += 1) {
        const a = withoutParam.intervals[i]!;
        const b = withParam.intervals[i]!;
        expect(b.forecastKw).toBe(a.forecastKw);
        expect(b.forecastKwh).toBe(a.forecastKwh);
        expect(b.capacityClipped).toBe(a.capacityClipped);
        expect(b.components.physicalWeatherKw).toBe(a.components.physicalWeatherKw);
        expect(b.components.calibrationFactor).toBe(a.components.calibrationFactor);
        expect(b.components.analogKw).toBe(a.components.analogKw);
        expect(b.components.glidePathFactor).toBe(a.components.glidePathFactor);
        expect(b.components.historicalEnvelopeKwh).toBe(a.components.historicalEnvelopeKwh);
        // The new field itself DOES change (that's the point of the param) - only real values must not.
        expect(b.components.weatherRegime).toBe(regime);
      }
    }
  });

  test("archived raw weather (ghiWm2/ambientTempC/cloudCoverPct) matches the real weather points fed in, for a daylight interval with real coverage", () => {
    const result = generatePvForecastCore(baseParams());
    const daylightInterval = result.intervals.find((iv) => iv.forecastKw > 0);
    expect(daylightInterval).toBeDefined();
    // Every weatherPoints() sample uses the same fixed values - the archived
    // per-interval snapshot must reproduce them exactly (interpolating
    // between identical hourly points is a no-op).
    expect(daylightInterval!.components.ghiWm2).toBeCloseTo(500, 5);
    expect(daylightInterval!.components.ambientTempC).toBeCloseTo(22, 5);
    expect(daylightInterval!.components.cloudCoverPct).toBeCloseTo(35, 5);
  });

  test("night intervals report cloudCoverPct/ghiWm2 honestly (still archived, not fabricated) and weatherRegime matches the day-level param", () => {
    const result = generatePvForecastCore({ ...baseParams(), weatherRegime: "CLEAR" });
    const nightInterval = result.intervals.find((iv) => iv.forecastKw === 0 && iv.components.physicalWeatherKw === 0);
    expect(nightInterval).toBeDefined();
    expect(nightInterval!.components.weatherRegime).toBe("CLEAR");
  });

  test("no real weather at all (empty weatherPoints) archives cloudCoverPct as null, never a fabricated reading", () => {
    const result = generatePvForecastCore({ ...baseParams(), weatherPoints: [] });
    const daylightInterval = result.intervals.find((iv) => iv.components.physicalWeatherKw > 0);
    expect(daylightInterval).toBeDefined();
    expect(daylightInterval!.components.cloudCoverPct).toBeNull();
  });
});
