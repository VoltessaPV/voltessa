import { test, expect } from "@playwright/test";

import { generatePvForecastCore } from "@/lib/forecast/pv-forecast-core";
import { estimatePhysicalPvKw } from "@/lib/forecast/physical-pv-model";
import type { HourOfDayCalibration } from "@/lib/forecast/calibration";
import type { SolarWeatherPoint } from "@/lib/weather/openMeteo";

/**
 * Atlanta forecast regression investigation. Regression coverage for the
 * `dailyCalibratedTotalKwh` bug in `generatePvForecastCore`: "today"'s
 * daily energy basis (used to rescale the analog component's normalized
 * shape into real kW) used to sum only from `forecastStart` (generation
 * time) onward, silently excluding every already-elapsed hour - so the
 * same plant, same real inputs, produced a materially different
 * `analogKw` for the SAME future target interval depending purely on
 * what time of day the forecast happened to be generated. Confirmed via a
 * live A/B reproduction against real Atlanta data: `analogKw` at ~13:45
 * swung from ~23 kW (generated 10:55) to ~95 kW (generated 09:10) for the
 * exact same target instant, with `physicalWeatherKw`/`calibrationFactor`
 * essentially identical between the two runs.
 *
 * This test reproduces the same shape with synthetic (not DB-backed)
 * inputs so it's a pure, deterministic unit test: `observedElapsedToday`
 * is constructed to exactly match what the calibrated model itself would
 * have predicted for each already-elapsed instant (calibration factors
 * map is empty, so `calibratedKw === physicalWeatherKw` throughout,
 * isolating the rescaling bug from calibration/analog-data effects).
 * With the fix, generating "now" at 09:10 vs 10:55 must produce
 * essentially the same `analogKw` for a shared future target (14:00) -
 * before the fix, this test would have failed by a wide margin (the
 * later generation time's `analogKw` came out at roughly a fifth of the
 * earlier one's, in the real A/B data this fixture mirrors).
 */

const LATITUDE = 42.892833; // Atlanta plant's real coordinates - only used for realistic solar geometry, not DB-backed.
const LONGITUDE = 24.701003;
const CAPACITY_KW = 200;
const DAY_START = new Date("2026-08-10T00:00:00.000Z");
const HORIZON_END = new Date("2026-08-11T00:00:00.000Z");
const TARGET = new Date("2026-08-10T14:00:00.000Z"); // shared future target, after both generation times below

const IDENTITY_CALIBRATION: HourOfDayCalibration = { factors: new Map(), sampleCount: 50, lookbackDays: 30 };

function hourlyWeatherPoints(): SolarWeatherPoint[] {
  const points: SolarWeatherPoint[] = [];
  for (let t = DAY_START.getTime() - 3 * 60 * 60 * 1000; t <= HORIZON_END.getTime() + 3 * 60 * 60 * 1000; t += 60 * 60 * 1000) {
    points.push({ time: new Date(t), irradiance: 600, cloudCover: 20, temperature: 25, windSpeed: 2, weatherCode: 1 });
  }
  return points;
}

/** A simple, non-degenerate normalized intraday shape (peaks mid-day) - deliberately different from the calibrated model's own exact curve, so blending is actually exercised. */
function buildAnalogShape(): number[] {
  const shape = new Array<number>(96).fill(0);
  // Buckets 24-72 (06:00-18:00 UTC) get a triangular-ish weight.
  for (let b = 24; b < 72; b += 1) {
    const distFromCenter = Math.abs(b - 48);
    shape[b] = Math.max(0, 24 - distFromCenter);
  }
  const total = shape.reduce((s, v) => s + v, 0);
  return shape.map((v) => v / total);
}

/** Synthetic "actual so far" that exactly matches the identity-calibrated physical model for every 5-minute sample strictly before `now` - isolates the rescaling bug from any real actual-vs-model discrepancy. */
function observedElapsedTodayMatchingModel(now: Date): Array<{ intervalStart: Date; availablePvKwh: number | null }> {
  const samples: Array<{ intervalStart: Date; availablePvKwh: number | null }> = [];
  for (let t = DAY_START.getTime(); t < now.getTime(); t += 5 * 60 * 1000) {
    const timestamp = new Date(t);
    const { forecastKw } = estimatePhysicalPvKw({
      timestamp,
      latitude: LATITUDE,
      longitude: LONGITUDE,
      ghiWm2: 600,
      ambientTempC: 25,
      capacityKw: CAPACITY_KW,
    });
    samples.push({ intervalStart: timestamp, availablePvKwh: forecastKw * (5 / 60) });
  }
  return samples;
}

test.describe("generatePvForecastCore - generation-time invariance", () => {
  test("analogKw for a shared future target is essentially the same whether generated at 09:10 or 10:55", () => {
    const weatherPoints = hourlyWeatherPoints();
    const analogShapeByDayUtc = new Map([["2026-08-10", { shape: buildAnalogShape(), dates: ["2026-08-01"] }]]);

    const earlyNow = new Date("2026-08-10T09:10:00.000Z");
    const lateNow = new Date("2026-08-10T10:55:00.000Z");

    const earlyResult = generatePvForecastCore({
      plantId: "test-plant",
      latitude: LATITUDE,
      longitude: LONGITUDE,
      capacityKw: CAPACITY_KW,
      now: earlyNow,
      horizonEnd: HORIZON_END,
      weatherPoints,
      calibration: IDENTITY_CALIBRATION,
      analogShapeByDayUtc,
      analogWeight: 0.5,
      observedElapsedToday: observedElapsedTodayMatchingModel(earlyNow),
    });

    const lateResult = generatePvForecastCore({
      plantId: "test-plant",
      latitude: LATITUDE,
      longitude: LONGITUDE,
      capacityKw: CAPACITY_KW,
      now: lateNow,
      horizonEnd: HORIZON_END,
      weatherPoints,
      calibration: IDENTITY_CALIBRATION,
      analogShapeByDayUtc,
      analogWeight: 0.5,
      observedElapsedToday: observedElapsedTodayMatchingModel(lateNow),
    });

    const earlyTarget = earlyResult.intervals.find((iv) => iv.timestamp.getTime() === TARGET.getTime());
    const lateTarget = lateResult.intervals.find((iv) => iv.timestamp.getTime() === TARGET.getTime());

    expect(earlyTarget).toBeDefined();
    expect(lateTarget).toBeDefined();
    expect(earlyTarget!.components.analogKw).not.toBeNull();
    expect(lateTarget!.components.analogKw).not.toBeNull();

    // Before the fix, the later generation time's analogKw came out at
    // roughly a fifth of the earlier one's for the real Atlanta A/B data
    // this fixture mirrors - a >90% relative difference. After the fix,
    // both runs share (approximately) the same full-day energy basis, so
    // the difference should be small - a generous 15% relative tolerance
    // comfortably separates "fixed" from "still generation-time-dependent".
    const diff = Math.abs(earlyTarget!.components.analogKw! - lateTarget!.components.analogKw!);
    const relativeDiff = diff / Math.max(earlyTarget!.components.analogKw!, lateTarget!.components.analogKw!);
    expect(relativeDiff).toBeLessThan(0.15);

    // physicalWeatherKw is a deterministic function of (timestamp, weather,
    // location) alone - must be identical regardless of generation time.
    expect(lateTarget!.components.physicalWeatherKw).toBeCloseTo(earlyTarget!.components.physicalWeatherKw, 1);
  });
});
