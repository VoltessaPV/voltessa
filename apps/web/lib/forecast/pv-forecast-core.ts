/**
 * PV Generation Forecast — pure ensemble core, split out of
 * `pv-forecast-engine.ts` so `generatePvForecastCore` (already a pure
 * function of its inputs, by design) can be unit-tested directly. The live
 * wrapper (`generatePvForecast`, still in `pv-forecast-engine.ts`) imports
 * `getAnalogDays` from `analog-days-cache.ts`, which imports `next/cache` —
 * an import that can only be resolved inside a real Next.js build/runtime,
 * not a plain Playwright/Node unit test. Keeping this file's own import
 * graph free of anything `next/cache`-tainted is what makes
 * `e2e/forecast-generation-time-invariance.spec.ts` possible. No behavior
 * change: same function, same logic, just relocated.
 */
import {
  applyHourOfDayCalibration,
  type HourOfDayCalibration,
} from "@/lib/forecast/calibration";
import { analogBucketIndex } from "@/lib/forecast/analog-days";
import type {
  ForecastConfidence,
  ForecastHorizonTier,
  WeatherRegime,
} from "@/lib/forecast/forecast-tiers";
import { applyGlidePath, computeRecentBias } from "@/lib/forecast/glide-path";
import { estimatePhysicalPvKw } from "@/lib/forecast/physical-pv-model";
import {
  FORECAST_INTERVAL_MINUTES,
  FORECAST_MODEL_VERSION,
  type PvForecastInterval,
  type PvForecastResult,
  type WeatherInputSource,
} from "@/lib/forecast/types";
import { interpolateWeatherAt } from "@/lib/forecast/weather-interpolation";
import { haurwitzClearSkyGhi } from "@/lib/forecast/clear-sky";
import { solarPositionAt } from "@/lib/forecast/solar-position";
import type { SolarWeatherPoint } from "@/lib/weather/openMeteo";

/**
 * PV Generation Forecast — ensemble orchestrator.
 *
 * Combines every layer (physical solar baseline + weather, plant-specific
 * historical calibration, analog days, recent glide-path correction) into
 * one 15-minute-resolution forecast. This is the single entry point every
 * caller (the Dashboard's `GlidepathCard`, the backtest harness) uses —
 * neither reimplements any of the blending logic itself.
 *
 * `generatePvForecastCore` is a pure function of its inputs (no I/O) so it
 * is directly deterministic/testable; `generatePvForecast`
 * (`pv-forecast-engine.ts`) is the live wrapper that fetches those inputs
 * from Open-Meteo and this plant's own historical data.
 */

export const DEFAULT_HORIZON_HOURS = 24;
/**
 * Selected via walk-forward backtesting against real Atlanta historical
 * data (10 test days spanning clear/cloudy/variable/Zero-Export/
 * non-Zero-Export conditions): candidates {0, 0.15, 0.2, 0.3, 0.5} were
 * each run through the full day-ahead backtest, and 0.5 produced the
 * lowest mean daily energy error (17.575% vs 17.585% at weight 0) — not an
 * arbitrary choice, though the effect size itself is small, a direct
 * consequence of this plant's short (~40-day) telemetry history limiting
 * how many genuinely similar analog days exist to blend in.
 */
export const DEFAULT_ANALOG_WEIGHT = 0.5;
const GLIDE_PATH_DECAY_HOURS = 3;
const RECENT_BIAS_WINDOW_HOURS = 2;
/** Neutral fallback ambient temperature (°C) used only when weather is entirely unavailable — see `weatherFallbackUsed`. */
const FALLBACK_AMBIENT_TEMP_C = 20;

function ceilTo15Min(date: Date): Date {
  const ms = FORECAST_INTERVAL_MINUTES * 60 * 1000;
  return new Date(Math.ceil(date.getTime() / ms) * ms);
}

export function dayStartUtc(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export function dayKeyUtc(date: Date): string {
  return dayStartUtc(date).toISOString().slice(0, 10);
}

/**
 * Aggregates today's native 5-minute reconstructed Available PV
 * (`observedElapsedToday`, `available-pv-reconstruction.ts`) into the same
 * 15-minute grid `intervals` uses — so a UI can plot "actual so far" and
 * "forecast for the rest" as one continuous series without reimplementing
 * this bucketing itself.
 */
/** Native telemetry samples per 15-minute bucket (5-minute grid, `historical-intervals.ts`) — a bucket only counts as "actual" once all three have arrived, never a partial/in-progress average presented as if it were a full 15 minutes. */
const NATIVE_SAMPLES_PER_BUCKET = 3;

function bucketObservedToday(
  observedElapsedToday: Array<{
    intervalStart: Date;
    availablePvKwh: number | null;
  }>,
): { timestamp: Date; actualKwh: number; actualKw: number }[] {
  const bucketMs = FORECAST_INTERVAL_MINUTES * 60 * 1000;
  const buckets = new Map<
    number,
    { sum: number; count: number; nullSeen: boolean }
  >();

  for (const point of observedElapsedToday) {
    const bucketStart =
      Math.floor(point.intervalStart.getTime() / bucketMs) * bucketMs;
    const entry = buckets.get(bucketStart) ?? {
      sum: 0,
      count: 0,
      nullSeen: false,
    };
    if (point.availablePvKwh === null) {
      entry.nullSeen = true;
    } else {
      entry.sum += point.availablePvKwh;
      entry.count += 1;
    }
    buckets.set(bucketStart, entry);
  }

  return Array.from(buckets.entries())
    .filter(
      ([, entry]) =>
        !entry.nullSeen && entry.count === NATIVE_SAMPLES_PER_BUCKET,
    )
    .sort(([a], [b]) => a - b)
    .map(([bucketStart, { sum }]) => ({
      timestamp: new Date(bucketStart),
      actualKwh: sum,
      actualKw: sum / (FORECAST_INTERVAL_MINUTES / 60),
    }));
}

/**
 * GHI/temperature at `timestamp` — real weather when available, otherwise a
 * clear-sky assumption (the physically neutral default: "assume the best
 * case, unmodified by clouds") so a weather-provider outage degrades the
 * forecast gracefully instead of producing no forecast at all, matching
 * this codebase's existing "external outage must never break the page"
 * convention (`fetchSolarWeatherSafe`).
 */
function weatherOrClearSkyFallback(
  weatherPoints: SolarWeatherPoint[],
  timestamp: Date,
  latitude: number,
  longitude: number,
): {
  irradiance: number;
  temperature: number;
  cloudCover: number | null;
  usedFallback: boolean;
} {
  const interpolated = interpolateWeatherAt(weatherPoints, timestamp);
  if (interpolated) {
    return { ...interpolated, usedFallback: false };
  }

  const { zenithDeg } = solarPositionAt(timestamp, latitude, longitude);
  // No real weather point available for this instant - cloudCover is honestly null (never fabricated) even
  // though a clear-sky irradiance/temperature assumption is still used as the physically neutral fallback.
  return {
    irradiance: haurwitzClearSkyGhi(zenithDeg),
    temperature: FALLBACK_AMBIENT_TEMP_C,
    cloudCover: null,
    usedFallback: true,
  };
}

export type ForecastCoreParams = {
  plantId: string;
  latitude: number;
  longitude: number;
  capacityKw: number;
  now: Date;
  horizonEnd: Date;
  weatherPoints: SolarWeatherPoint[];
  calibration: HourOfDayCalibration;
  analogShapeByDayUtc: Map<
    string,
    {
      shape: number[] | null;
      dates: string[];
      analogMagnitudeKwh?: number | null;
    }
  >;
  analogWeight: number;
  observedElapsedToday: Array<{
    intervalStart: Date;
    availablePvKwh: number | null;
  }>;
  decayHours?: number;
  /** Which forecast-hierarchy tier this whole call represents (see `lib/forecast/forecast-tiers.ts`) — stamped onto every produced interval. Defaults preserve this function's original single-tier behavior for any caller that doesn't pass one (e.g. the backtest harness). */
  horizonTier?: ForecastHorizonTier;
  confidence?: ForecastConfidence;
  /**
   * Weather-horizon honesty fix (Aug 2026 Chomakovtsi investigation):
   * whether the caller's OWN day-level check (`pv-forecast-engine.ts`'s
   * `hasRealWeather`) found any real Open-Meteo coverage for this call's
   * day — decoupled from `horizonTier`, since a day can be nominally SHORT
   * by lead-time while Open-Meteo's actual coverage doesn't reach it (see
   * `types.ts`'s `WeatherInputSource`). Defaults to `"REAL_FORECAST"` so
   * every existing caller (including the generation-time-invariance e2e
   * fixture, which never specifies this) keeps byte-identical behavior —
   * the historical-envelope blend below never activates unless a caller
   * explicitly says the day has no real weather.
   */
  weatherSource?: WeatherInputSource;
  /**
   * Median(actual / calibrated-clear-sky) across this plant's own recent
   * real days (`cloudiness-envelope.ts`) — `null` when there isn't enough
   * history to trust one, or when the caller doesn't supply it (e.g. the
   * generation-time-invariance fixture). Only ever consulted for a day
   * that is BOTH `weatherSource === "CLEAR_SKY_FALLBACK"` AND has no valid
   * analog-day candidate — see the blend logic below.
   */
  historicalCloudinessFactor?: number | null;
  /**
   * D+1 learning-infrastructure milestone (Aug 2026): a day-level weather
   * regime label, computed one level up (`pv-forecast-engine.ts`, from the
   * same `targetMeanCloudCover`/`cloudVolatility` it already computes for
   * `classifyConfidence`) — purely stamped onto every interval's
   * `components.weatherRegime` for later archival/stratification, never
   * consulted by any part of the blend logic below. Defaults to
   * `"UNKNOWN"` so every existing caller (including the generation-time-
   * invariance fixture, which never specifies this) keeps byte-identical
   * numeric behavior.
   */
  weatherRegime?: WeatherRegime;
};

export function generatePvForecastCore(
  params: ForecastCoreParams,
): PvForecastResult {
  const {
    plantId,
    latitude,
    longitude,
    capacityKw,
    now,
    horizonEnd,
    weatherPoints,
    calibration,
    analogShapeByDayUtc,
    analogWeight,
    observedElapsedToday,
    decayHours = GLIDE_PATH_DECAY_HOURS,
    horizonTier = "SHORT",
    confidence = "MEDIUM",
    weatherSource = "REAL_FORECAST",
    historicalCloudinessFactor = null,
    weatherRegime = "UNKNOWN",
  } = params;

  let weatherFallbackUsed = false;

  // Recent bias: compare the last `RECENT_BIAS_WINDOW_HOURS` of real,
  // reconstructed Available PV against what the physical+weather+
  // calibration model would have said for those same instants.
  const recentBiasWindowStart = new Date(
    now.getTime() - RECENT_BIAS_WINDOW_HOURS * 60 * 60 * 1000,
  );
  const observedVsModel = observedElapsedToday
    .filter(
      (point) =>
        point.intervalStart.getTime() >= recentBiasWindowStart.getTime() &&
        point.intervalStart.getTime() < now.getTime(),
    )
    .map((point) => {
      const weather = weatherOrClearSkyFallback(
        weatherPoints,
        point.intervalStart,
        latitude,
        longitude,
      );
      weatherFallbackUsed = weatherFallbackUsed || weather.usedFallback;
      const physicalKw = estimatePhysicalPvKw({
        timestamp: point.intervalStart,
        latitude,
        longitude,
        ghiWm2: weather.irradiance,
        ambientTempC: weather.temperature,
        capacityKw,
      }).forecastKw;
      const calibratedKw = applyHourOfDayCalibration(
        calibration,
        point.intervalStart,
        physicalKw,
      );
      return {
        actualKw:
          point.availablePvKwh !== null ? point.availablePvKwh / (5 / 60) : 0,
        modelKw: calibratedKw,
      };
    })
    .filter((point) => point.modelKw > 0);

  const recentBias = computeRecentBias(observedVsModel);

  const forecastStart = ceilTo15Min(now);
  const intervalMs = FORECAST_INTERVAL_MINUTES * 60 * 1000;
  const timestamps: Date[] = [];
  for (
    let t = forecastStart.getTime();
    t < horizonEnd.getTime();
    t += intervalMs
  ) {
    timestamps.push(new Date(t));
  }

  // Pass 1: physical + weather + calibration, per timestamp; also
  // accumulate each calendar day's calibrated energy total (needed to
  // rescale the analog component's normalized shape into real kW).
  const perTimestamp = timestamps.map((timestamp) => {
    const weather = weatherOrClearSkyFallback(
      weatherPoints,
      timestamp,
      latitude,
      longitude,
    );
    weatherFallbackUsed = weatherFallbackUsed || weather.usedFallback;
    const physical = estimatePhysicalPvKw({
      timestamp,
      latitude,
      longitude,
      ghiWm2: weather.irradiance,
      ambientTempC: weather.temperature,
      capacityKw,
    });
    const calibratedKw = applyHourOfDayCalibration(
      calibration,
      timestamp,
      physical.forecastKw,
    );
    const weatherInputSource: WeatherInputSource = weather.usedFallback
      ? "CLEAR_SKY_FALLBACK"
      : "REAL_FORECAST";
    return {
      timestamp,
      physicalWeatherKw: physical.forecastKw,
      calibratedKw,
      isDaylight: physical.forecastKw > 0 || physical.elevationDeg > 0,
      weatherInputSource,
      // D+1 learning-infrastructure milestone: raw issuance-time weather, archived (via
      // forecast-persistence.ts) alongside the derived physicalWeatherKw - never read back
      // into any of the math below, purely a diagnostic/archival passthrough of what
      // weatherOrClearSkyFallback already computed.
      ghiWm2: weather.irradiance,
      ambientTempC: weather.temperature,
      cloudCoverPct: weather.cloudCover,
    };
  });

  const dailyCalibratedTotalKwh = new Map<string, number>();
  // Historical cloudiness envelope (Aug 2026 Chomakovtsi investigation):
  // the SAME per-instant physical estimate before calibration, summed per
  // day — for a `CLEAR_SKY_FALLBACK` day this is exactly the "pure
  // clear-sky physical total" the envelope's own denominator (in
  // `cloudiness-envelope.ts`) was computed against, so the two are
  // directly comparable.
  const dailyPhysicalOnlyKwh = new Map<string, number>();
  for (const point of perTimestamp) {
    const key = dayKeyUtc(point.timestamp);
    dailyCalibratedTotalKwh.set(
      key,
      (dailyCalibratedTotalKwh.get(key) ?? 0) +
        point.calibratedKw * (FORECAST_INTERVAL_MINUTES / 60),
    );
    dailyPhysicalOnlyKwh.set(
      key,
      (dailyPhysicalOnlyKwh.get(key) ?? 0) +
        point.physicalWeatherKw * (FORECAST_INTERVAL_MINUTES / 60),
    );
  }

  // Bug fix (Atlanta forecast regression investigation): `perTimestamp` only
  // spans `[forecastStart, horizonEnd)` - for every day except the first,
  // the caller passes `now = dayStart`, so that day's own sum above already
  // covers its full 24h. But for the FIRST day (real "now", mid-day at
  // generation time), this sum silently EXCLUDES every hour already elapsed
  // before `now` - understating "today's" daily total more and more the
  // later in the day the forecast happens to run, which in turn made the
  // analog component's rescaled kW value (below) swing wildly depending on
  // generation time alone, with otherwise-identical inputs. Restore the
  // missing elapsed portion using REAL, already-settled Available PV
  // (`observedElapsedToday`, the same Zero-Export-independent source this
  // engine already trusts elsewhere) rather than a fabricated calibrated
  // value for hours that already have ground truth - never future actual
  // data, since `observedElapsedToday` is only ever populated for instants
  // strictly before `now` (see this function's only caller). No double
  // counting: `perTimestamp` starts at `forecastStart >= now`, so the two
  // sums cover disjoint, adjacent time ranges.
  if (observedElapsedToday.length > 0) {
    const actualSoFarKwh = observedElapsedToday.reduce(
      (sum, point) => sum + (point.availablePvKwh ?? 0),
      0,
    );
    const todayKey = dayKeyUtc(now);
    dailyCalibratedTotalKwh.set(
      todayKey,
      (dailyCalibratedTotalKwh.get(todayKey) ?? 0) + actualSoFarKwh,
    );
  }

  const analogDatesUsed = new Set<string>();

  const intervals: PvForecastInterval[] = perTimestamp.map(
    ({
      timestamp,
      physicalWeatherKw,
      calibratedKw,
      isDaylight,
      weatherInputSource,
      ghiWm2,
      ambientTempC,
      cloudCoverPct,
    }) => {
      // Night is structural, not statistical: no analog/glide-path/
      // calibration noise can ever push a night interval above zero.
      if (!isDaylight) {
        return {
          timestamp,
          forecastKwh: 0,
          forecastKw: 0,
          capacityClipped: false,
          horizonTier,
          confidence,
          components: {
            physicalWeatherKw: 0,
            calibrationFactor: 1,
            analogKw: null,
            analogWeight,
            glidePathFactor: 1,
            weatherInputSource,
            historicalEnvelopeKwh: null,
            ghiWm2,
            ambientTempC,
            cloudCoverPct,
            weatherRegime,
          },
        };
      }

      const dayKey = dayKeyUtc(timestamp);
      const analogEntry = analogShapeByDayUtc.get(dayKey);
      const physicalDailyTotalKwh = dailyCalibratedTotalKwh.get(dayKey) ?? 0;
      const physicalOnlyDailyTotalKwh = dailyPhysicalOnlyKwh.get(dayKey) ?? 0;

      let analogKw: number | null = null;
      if (analogEntry?.shape && physicalDailyTotalKwh > 0) {
        const bucket = analogBucketIndex(timestamp);
        const shapeFraction = analogEntry.shape[bucket] ?? 0;

        // MEDIUM/LONG tier realism fix (Aug 2026 investigation): beyond the
        // real-weather horizon, `physicalDailyTotalKwh` is itself an
        // optimistic clear-sky assumption (`weatherOrClearSkyFallback`) -
        // confirmed by backtest to run ~13-16% hot on typical days versus
        // this plant's own real history. The analog days already selected
        // above are this plant's own real historical production for
        // similar days; blend their real magnitude into the day's energy
        // budget - not just their shape - using the SAME `analogWeight`
        // the outer physical/analog blend below already trusts, so
        // confidence in analog magnitude grows exactly in step with
        // confidence in analog shape. Never inflates: capped at the
        // physical ceiling, since clear sky is the physical maximum a real
        // day cannot exceed. SHORT tier (real weather available) is
        // completely untouched - always pure physical, exactly as before
        // this fix. `analogMagnitudeKwh` is a median across the (up to 3)
        // selected analog days precisely so one unusually strong or weak
        // day can never unilaterally drag the forecast - see
        // `pv-forecast-engine.ts`'s `median` helper.
        const analogMagnitudeKwh = analogEntry.analogMagnitudeKwh ?? null;
        const dailyTotalKwh =
          horizonTier !== "SHORT" && analogMagnitudeKwh !== null
            ? physicalDailyTotalKwh * (1 - analogWeight) +
              Math.min(analogMagnitudeKwh, physicalDailyTotalKwh) * analogWeight
            : physicalDailyTotalKwh;

        analogKw =
          (shapeFraction * dailyTotalKwh) / (FORECAST_INTERVAL_MINUTES / 60);
        for (const date of analogEntry.dates) {
          analogDatesUsed.add(date);
        }
      }

      // Historical cloudiness envelope fallback (Aug 2026 Chomakovtsi
      // investigation): only reached when there was no analog shape to
      // blend above (`analogKw` still `null`) AND this day has no real
      // weather AND the tier trusts historical signal enough to apply it
      // (never SHORT). Root cause this exists for: for a plant with zero
      // valid analog-day candidates (Chomakovtsi's permanent state - its
      // telemetry coverage fails `analog-days.ts`'s 80% quality gate), a
      // clear-sky-fallback day previously had NOTHING to moderate the
      // physical model's inherent clear-sky optimism - confirmed via
      // backtest to push Chomakovtsi's 2026-08-13 forecast to 735.2 kWh
      // against a 40-day historical maximum of 703.9 kWh, even though the
      // plant's OWN 1.316 hour-of-day calibration factor is itself
      // statistically justified (stable across every lookback window
      // tested). There is no analog SHAPE available here to redistribute
      // (unlike the block above), so this scales the physical/calibration
      // model's OWN already-physically-derived intraday shape by a single
      // day-level factor instead of substituting a different one - the
      // clear-sky model's time-of-day curve is still physically valid, only
      // its total magnitude was overconfident. `historicalCloudinessFactor`
      // (`cloudiness-envelope.ts`) is this plant's own median
      // actual/calibrated-clear-sky ratio across its recent real history -
      // never a flat/arbitrary discount - blended in via the SAME
      // `analogWeight` the tier already uses to trust historical signal
      // over raw physical, and capped at the physical ceiling exactly like
      // the analog magnitude above (never inflates).
      let historicalEnvelopeKwh: number | null = null;
      let envelopeScaleFactor = 1;
      if (
        analogKw === null &&
        horizonTier !== "SHORT" &&
        weatherSource === "CLEAR_SKY_FALLBACK" &&
        historicalCloudinessFactor !== null &&
        physicalOnlyDailyTotalKwh > 0 &&
        physicalDailyTotalKwh > 0
      ) {
        historicalEnvelopeKwh =
          physicalOnlyDailyTotalKwh * historicalCloudinessFactor;
        const blendedDailyTotalKwh =
          physicalDailyTotalKwh * (1 - analogWeight) +
          Math.min(historicalEnvelopeKwh, physicalDailyTotalKwh) * analogWeight;
        envelopeScaleFactor = blendedDailyTotalKwh / physicalDailyTotalKwh;
      }
      const scaledCalibratedKw = calibratedKw * envelopeScaleFactor;

      const combinedKw =
        analogKw !== null
          ? scaledCalibratedKw * (1 - analogWeight) + analogKw * analogWeight
          : scaledCalibratedKw;
      const glideKw = applyGlidePath(
        combinedKw,
        timestamp,
        now,
        recentBias,
        decayHours,
      );

      const capacityClipped = glideKw > capacityKw;
      const forecastKw = Math.min(capacityKw, Math.max(0, glideKw));
      const glidePathFactor = combinedKw > 0 ? glideKw / combinedKw : 1;
      const calibrationFactor =
        physicalWeatherKw > 0 ? calibratedKw / physicalWeatherKw : 1;

      return {
        timestamp,
        forecastKwh: forecastKw * (FORECAST_INTERVAL_MINUTES / 60),
        forecastKw,
        capacityClipped,
        horizonTier,
        confidence,
        components: {
          physicalWeatherKw,
          calibrationFactor,
          analogKw,
          analogWeight,
          glidePathFactor,
          weatherInputSource,
          historicalEnvelopeKwh,
          ghiWm2,
          ambientTempC,
          cloudCoverPct,
          weatherRegime,
        },
      };
    },
  );

  return {
    modelVersion: FORECAST_MODEL_VERSION,
    weatherSource: "open-meteo",
    generatedAt: now,
    plantId,
    intervalMinutes: FORECAST_INTERVAL_MINUTES,
    intervals,
    observedToday: bucketObservedToday(observedElapsedToday),
    diagnostics: {
      calibrationSampleCount: calibration.sampleCount,
      calibrationLookbackDays: calibration.lookbackDays,
      analogDayDates: Array.from(analogDatesUsed).sort(),
      analogWeight,
      recentBias,
      weatherFallbackUsed,
      // This pure core function never calls `getAnalogDays` itself (the
      // live wrapper in `pv-forecast-engine.ts` does, once per day, before
      // invoking this function) - it has no rejection data of its own to
      // report.
      analogCandidatesRejected: [],
    },
  };
}
