/**
 * Live Energy Forecast Integration milestone — the forecast hierarchy.
 *
 * We cannot obtain a reliable detailed weather forecast 25-30 days out, and
 * this module never pretends otherwise. Every forecasted interval is
 * classified into exactly one tier by how far ahead of the real issuance
 * instant it falls, and each tier trusts a different mix of the same
 * underlying layers (`lib/forecast/*` — no second forecasting algorithm):
 *
 * - SHORT (0-48h): Open-Meteo's real forecast covers this window (see
 *   `lib/weather/openMeteo.ts`'s `FORECAST_DAYS`). Physical+weather model,
 *   plant calibration, and analog days blend at the already-validated
 *   default weight.
 * - MEDIUM (48h-10 days): no real weather forecast this far out, so the
 *   physical-model layer already falls back to a clear-sky assumption
 *   (`pv-forecast-engine.ts`'s `weatherOrClearSkyFallback`) — trusted less
 *   here, with analog days (this plant's own real historical shape for
 *   similar days) weighted more heavily.
 * - LONG (>10 days): no weather signal at all. The forecast becomes an
 *   explicit climatological estimate: day-of-year, daylight duration,
 *   solar geometry, and plant calibration set the physical envelope: the
 *   analog-day mechanism (weighted almost entirely) supplies the realistic
 *   magnitude and shape from this exact plant's own historical production
 *   for comparable days. This is deliberately labelled low-confidence, not
 *   presented as a precise weather-driven forecast.
 */
import { haurwitzClearSkyGhi } from "@/lib/forecast/clear-sky";
import { solarPositionAt } from "@/lib/forecast/solar-position";

export type ForecastHorizonTier = "SHORT" | "MEDIUM" | "LONG";
export type ForecastConfidence = "HIGH" | "MEDIUM" | "LOW";

/**
 * D+1 learning-infrastructure milestone (Aug 2026): a day-level label for
 * later analysis/training-example stratification ("clear-day accuracy" vs
 * "cloudy-day accuracy") — NOT consumed anywhere in the forecast-value
 * computation itself, only archived alongside a vintage's other diagnostic
 * inputs. `UNKNOWN` is the honest answer whenever there's no real weather
 * to classify from (clear-sky-fallback days) — never guessed.
 */
export type WeatherRegime =
  | "CLEAR"
  | "PARTLY_CLOUDY"
  | "CLOUDY"
  | "RAPIDLY_CHANGING"
  | "UNKNOWN";

const SHORT_RANGE_HOURS = 48;
const MEDIUM_RANGE_HOURS = 10 * 24;

/** Weighting toward the analog-day component per tier — see this module's own doc comment for why trust shifts from weather-driven to analog-driven as lead time grows. Not arbitrary: SHORT keeps the value `pv-forecast-engine.ts` already validated via backtesting; MEDIUM/LONG are directional continuations of the same principle (less real weather signal -> more weight on this plant's own real historical shape), stated explicitly as an estimate rather than re-tuned against a test set per this milestone's own instruction not to keep tuning. */
const ANALOG_WEIGHT_BY_TIER: Record<ForecastHorizonTier, number> = {
  SHORT: 0.5,
  MEDIUM: 0.7,
  LONG: 0.9,
};

export function classifyHorizonTier(
  leadTimeHours: number,
): ForecastHorizonTier {
  if (leadTimeHours <= SHORT_RANGE_HOURS) return "SHORT";
  if (leadTimeHours <= MEDIUM_RANGE_HOURS) return "MEDIUM";
  return "LONG";
}

export function analogWeightForTier(tier: ForecastHorizonTier): number {
  return ANALOG_WEIGHT_BY_TIER[tier];
}

/**
 * Simple, non-statistical confidence label — never a fabricated precise
 * percentage (per this milestone's explicit instruction). LONG is always
 * LOW (no real weather signal at all, regardless of how good the analog
 * match happens to be). Within SHORT/MEDIUM, cloud-cover volatility
 * (already computed for the weather-regime classification elsewhere in
 * this codebase's audits) and how many real analog days were actually
 * found are the only two signals used.
 */
export function classifyConfidence(params: {
  tier: ForecastHorizonTier;
  cloudVolatility: number | null;
  analogDayCount: number;
}): ForecastConfidence {
  const { tier, cloudVolatility, analogDayCount } = params;

  if (tier === "LONG") {
    return "LOW";
  }

  const stableWeather = cloudVolatility === null || cloudVolatility < 15;
  const moderateWeather = cloudVolatility !== null && cloudVolatility < 30;

  if (tier === "SHORT") {
    if (stableWeather && analogDayCount >= 2) return "HIGH";
    if (moderateWeather) return "MEDIUM";
    return "LOW";
  }

  // MEDIUM
  if (stableWeather && analogDayCount >= 2) return "MEDIUM";
  return "LOW";
}

/**
 * Classifies a day's weather regime from the SAME two signals
 * `classifyConfidence` already trusts for "how stable is this day's
 * weather" — `meanCloudCoverPct` (this day's own mean cloud cover) and
 * `cloudVolatility` (its stddev across the day) — not a new, separately
 * tuned pair of thresholds. `cloudVolatility >= 30` reuses exactly the
 * boundary `classifyConfidence` already calls "not moderate weather";
 * the 20/50 mean-cloud-cover buckets match what this session's own
 * clear-sky validation already used to separate clear/partly-cloudy/cloudy
 * days. `null` mean cloud cover (no real weather - clear-sky fallback)
 * always returns `UNKNOWN`, never a guessed regime.
 */
export function classifyWeatherRegime(params: {
  meanCloudCoverPct: number | null;
  cloudVolatility: number | null;
}): WeatherRegime {
  const { meanCloudCoverPct, cloudVolatility } = params;
  if (meanCloudCoverPct === null) {
    return "UNKNOWN";
  }
  if (cloudVolatility !== null && cloudVolatility >= 30) {
    return "RAPIDLY_CHANGING";
  }
  if (meanCloudCoverPct < 20) {
    return "CLEAR";
  }
  if (meanCloudCoverPct < 50) {
    return "PARTLY_CLOUDY";
  }
  return "CLOUDY";
}

/**
 * Climatological irradiance estimate for a calendar day with no real
 * weather forecast coverage — the mean clear-sky GHI (Haurwitz) across
 * that day's own daylight hours, purely from solar geometry. Used only to
 * rank analog-day weather similarity when no real forecast exists (see
 * `getAnalogDays`'s `targetMeanGhi` parameter) — never fed into the
 * physical power model directly as if it were a real forecast (the
 * physical-model layer already falls back to its own per-instant
 * clear-sky estimate independently, see `weatherOrClearSkyFallback`).
 */
export function meanClearSkyGhiForDay(
  dayStart: Date,
  latitude: number,
  longitude: number,
): number {
  const stepMs = 15 * 60 * 1000;
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const samples: number[] = [];

  for (let t = dayStart.getTime(); t < dayEnd.getTime(); t += stepMs) {
    const timestamp = new Date(t);
    const { zenithDeg, elevationDeg } = solarPositionAt(
      timestamp,
      latitude,
      longitude,
    );
    if (elevationDeg > 0) {
      samples.push(haurwitzClearSkyGhi(zenithDeg));
    }
  }

  return samples.length > 0
    ? samples.reduce((sum, value) => sum + value, 0) / samples.length
    : 0;
}
