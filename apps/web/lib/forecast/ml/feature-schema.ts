import { classifyHorizonTier, type ForecastHorizonTier, type WeatherRegime } from "@/lib/forecast/forecast-tiers";

/**
 * D+1 Self-Learning Forecast milestone (Aug 2026) — the ML pipeline's
 * feature vector. This is the SINGLE definition of "what the correction
 * model sees," used by both the training-dataset exporter
 * (`scripts/ml/export-training-dataset.ts`) and live inference
 * (`lib/forecast/ml/ml-correction.ts`). There is deliberately no second,
 * Python-side reimplementation of this logic — Python only ever receives
 * an already-built numeric matrix (see `scripts/ml/export-training-dataset.ts`),
 * never raw physical/weather inputs it would have to reconstruct itself.
 * This eliminates train/serve skew structurally, not by convention: the
 * exact same `buildFeatureVector` call produces both the training rows and
 * the live inference input.
 *
 * `FEATURE_SCHEMA_VERSION` must be bumped whenever `FEATURE_NAMES` or
 * `buildFeatureVector`'s output changes shape/order/meaning —
 * `ForecastModelVersion.featureSchemaVersion` is checked against this
 * constant before inference runs, and a mismatch refuses to run rather
 * than silently feeding a model a differently-shaped vector than it was
 * trained on.
 *
 * Plant identity is deliberately encoded as CONTINUOUS characteristics
 * (`capacityKw`, `latitude`, `longitude`) rather than a one-hot plant ID —
 * this is what lets a brand-new plant benefit from the global model
 * immediately (per this milestone's own cold-start requirement): its own
 * real capacity/location plug directly into features the model already
 * knows how to use, with no new categorical level and no retraining
 * required, unlike a one-hot `plantIsAtlanta`-style flag which would need
 * the model retrained to even recognize a new plant exists.
 *
 * `cloudCoverPct` is passed through as `NaN` (never a fabricated default)
 * whenever no real weather point was available for that interval
 * (`weatherOrClearSkyFallback`'s clear-sky-fallback path) — both LightGBM
 * and XGBoost natively support NaN as "missing" and learn split directions
 * around it, which is the documented, literature-supported way to handle
 * missing weather features (see this project's own architecture review
 * citing GBM's native missing-value handling), not an imputed placeholder.
 *
 * Multi-Horizon Self-Learning Forecast milestone (Aug 2026, v2): every
 * forecast — D+1 through the long horizon — shares this ONE feature
 * schema and ONE global model; the model is told which horizon it's
 * predicting via `horizonTier` (one-hot, reusing the exact SHORT/MEDIUM/
 * LONG boundaries `forecast-tiers.ts`'s `classifyHorizonTier` already
 * defines for the physical pipeline — not a second, separately-tuned
 * boundary) plus a continuous `leadDaysNorm`. This is what lets the tree
 * learn "trust the physical/weather features heavily at SHORT, trust them
 * far less and lean on season/location/recent-plant-behavior at LONG"
 * automatically from data, rather than needing a second model per horizon
 * band. `cloudCoverFrac`/`ghiNorm` are already honestly `NaN`/clear-sky
 * for MEDIUM/LONG rows (no real weather exists that far out — see the
 * exporter's own per-tier weather-honesty logic), so the model has every
 * signal it needs to learn that dependency itself.
 */

export const FEATURE_SCHEMA_VERSION = "d1-ml-v2";

export const FEATURE_NAMES = [
  "bias",
  "physKwNorm",
  "ghiNorm",
  "tempNorm",
  "elevNorm",
  "clearSkyIndex",
  "cloudCoverFrac", // NaN when unavailable - see doc comment above
  "hourSin",
  "hourCos",
  "doySin",
  "doyCos",
  "latitudeNorm",
  "longitudeNorm",
  "capacityNorm",
  "leadNorm",
  "leadDaysNorm",
  "recentResidNorm",
  "regimeIsClear",
  "regimeIsPartlyCloudy",
  "regimeIsCloudy",
  "regimeIsRapidlyChanging",
  "tierIsShort",
  "tierIsMedium",
  "tierIsLong",
  // interactions
  "phys_x_clearSky",
  "phys_x_recentResid",
  "hourSin_x_clearSky",
  "phys_x_latitude",
  "phys_x_tierIsLong",
] as const;

export type FeatureBuilderInput = {
  timestamp: Date;
  physicalWeatherKw: number;
  capacityKw: number;
  ghiWm2: number;
  ambientTempC: number;
  elevationDeg: number;
  clearSkyIndex: number;
  /** `null` when no real weather point was available for this exact interval. */
  cloudCoverPct: number | null;
  latitude: number;
  longitude: number;
  leadTimeMinutes: number;
  weatherRegime: WeatherRegime;
  /**
   * Trailing rolling median residual (actualKw - physicalKw) over the last
   * few COMPLETED days for this plant, in kW — the D+1-appropriate
   * "recent forecast error" feature (day-granularity, not glide-path's
   * intraday-minutes granularity, since a D+1 forecast issued at noon has
   * no meaning for "the last 2 hours" the way a same-day forecast does).
   * Callers must compute this only from days strictly before the day being
   * predicted — see the leakage tests in `e2e/ml-feature-leakage.spec.ts`.
   * `0` when there isn't enough prior history yet (cold start).
   */
  recentResidualKw: number;
};

function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((d.getTime() - start) / (24 * 60 * 60 * 1000));
}

/**
 * Pure function: identical input always produces an identical output
 * vector (no `Date.now()`, no hidden state, no I/O) — this determinism is
 * itself one of this milestone's explicit leakage-prevention requirements,
 * verified by `e2e/ml-feature-leakage.spec.ts`.
 */
export function buildFeatureVector(input: FeatureBuilderInput): number[] {
  const hourFrac = input.timestamp.getUTCHours() + input.timestamp.getUTCMinutes() / 60;
  const hourAngle = (2 * Math.PI * hourFrac) / 24;
  const doyAngle = (2 * Math.PI * dayOfYear(input.timestamp)) / 365.25;

  const physKwNorm = input.capacityKw > 0 ? input.physicalWeatherKw / input.capacityKw : 0;
  const ghiNorm = input.ghiWm2 / 1000;
  const tempNorm = input.ambientTempC / 30;
  const elevNorm = input.elevationDeg / 90;
  const cloudCoverFrac = input.cloudCoverPct === null ? Number.NaN : input.cloudCoverPct / 100;
  const latitudeNorm = input.latitude / 90;
  const longitudeNorm = input.longitude / 180;
  const capacityNorm = input.capacityKw / 150; // 150kW is the rough order-of-magnitude scale of this fleet today - a pure normalization constant, not a physical limit
  const leadNorm = input.leadTimeMinutes / (24 * 60);
  const leadDaysNorm = input.leadTimeMinutes / (24 * 60) / 35; // 35d ~ DEFAULT_EXTENDED_HORIZON_DAYS, a pure scale constant
  const recentResidNorm = input.capacityKw > 0 ? input.recentResidualKw / input.capacityKw : 0;

  const regimeIsClear = input.weatherRegime === "CLEAR" ? 1 : 0;
  const regimeIsPartlyCloudy = input.weatherRegime === "PARTLY_CLOUDY" ? 1 : 0;
  const regimeIsCloudy = input.weatherRegime === "CLOUDY" ? 1 : 0;
  const regimeIsRapidlyChanging = input.weatherRegime === "RAPIDLY_CHANGING" ? 1 : 0;
  // UNKNOWN is the implicit all-zeros case - never given its own column, since a model
  // seeing all four regime flags at 0 already has a clean, unambiguous "no regime signal" state.

  const tier = classifyHorizonTier(input.leadTimeMinutes / 60);
  const tierIsShort = tier === "SHORT" ? 1 : 0;
  const tierIsMedium = tier === "MEDIUM" ? 1 : 0;
  const tierIsLong = tier === "LONG" ? 1 : 0;

  return [
    1, // bias
    physKwNorm,
    ghiNorm,
    tempNorm,
    elevNorm,
    input.clearSkyIndex,
    cloudCoverFrac,
    Math.sin(hourAngle),
    Math.cos(hourAngle),
    Math.sin(doyAngle),
    Math.cos(doyAngle),
    latitudeNorm,
    longitudeNorm,
    capacityNorm,
    leadNorm,
    leadDaysNorm,
    recentResidNorm,
    regimeIsClear,
    regimeIsPartlyCloudy,
    regimeIsCloudy,
    regimeIsRapidlyChanging,
    tierIsShort,
    tierIsMedium,
    tierIsLong,
    physKwNorm * input.clearSkyIndex,
    physKwNorm * recentResidNorm,
    Math.sin(hourAngle) * input.clearSkyIndex,
    physKwNorm * latitudeNorm,
    physKwNorm * tierIsLong,
  ];
}

/**
 * Two-stage architecture (magnitude + shape), per this project's own
 * validated Phase 1 finding that decoupling them beat one unified
 * per-interval model. Stage 1 predicts one value per plant-day: the
 * day's total residual (`actualDailyKwh - physicalDailyKwh`) — a much
 * smaller, day-level feature vector, since daily magnitude doesn't need
 * per-interval time-of-day detail. Stage 2 (the interval-level
 * `buildFeatureVector` above) predicts the per-interval shape residual;
 * at inference time its 96 raw predictions are rescaled so their sum
 * matches Stage 1's predicted daily total — exactly the C3 methodology
 * already validated against real data in the Phase 1 offline experiment.
 */
export const DAILY_FEATURE_NAMES = [
  "bias",
  "physicalDailyKwhNorm",
  "meanGhiNorm",
  "meanCloudFrac",
  "doySin",
  "doyCos",
  "latitudeNorm",
  "longitudeNorm",
  "capacityNorm",
  "leadDaysNorm",
  "recentResidDailyNorm",
  "regimeIsClear",
  "regimeIsPartlyCloudy",
  "regimeIsCloudy",
  "regimeIsRapidlyChanging",
  "tierIsShort",
  "tierIsMedium",
  "tierIsLong",
] as const;

export type DailyFeatureBuilderInput = {
  date: Date; // any instant within the day, used only for day-of-year
  physicalDailyKwh: number;
  capacityKw: number;
  meanGhiWm2: number;
  meanCloudCoverPct: number | null;
  latitude: number;
  longitude: number;
  weatherRegime: WeatherRegime;
  /** Lead time from issuance to this day's own start, in minutes - same horizon signal the interval-level vector carries, so Stage 1 (magnitude) also knows how far ahead it's predicting. */
  leadTimeMinutes: number;
  /** Trailing rolling median DAILY residual (kWh) over the last few completed days - same walk-forward-safe contract as the interval-level `recentResidualKw`. */
  recentResidualDailyKwh: number;
};

export function buildDailyFeatureVector(input: DailyFeatureBuilderInput): number[] {
  const doyAngle = (2 * Math.PI * dayOfYear(input.date)) / 365.25;
  const physicalDailyKwhNorm = input.capacityKw > 0 ? input.physicalDailyKwh / (input.capacityKw * 24) : 0;
  const meanGhiNorm = input.meanGhiWm2 / 500;
  const meanCloudFrac = input.meanCloudCoverPct === null ? Number.NaN : input.meanCloudCoverPct / 100;
  const latitudeNorm = input.latitude / 90;
  const longitudeNorm = input.longitude / 180;
  const capacityNorm = input.capacityKw / 150;
  const leadDaysNorm = input.leadTimeMinutes / (24 * 60) / 35;
  const recentResidDailyNorm = input.capacityKw > 0 ? input.recentResidualDailyKwh / (input.capacityKw * 24) : 0;

  const regimeIsClear = input.weatherRegime === "CLEAR" ? 1 : 0;
  const regimeIsPartlyCloudy = input.weatherRegime === "PARTLY_CLOUDY" ? 1 : 0;
  const regimeIsCloudy = input.weatherRegime === "CLOUDY" ? 1 : 0;
  const regimeIsRapidlyChanging = input.weatherRegime === "RAPIDLY_CHANGING" ? 1 : 0;

  const tier = classifyHorizonTier(input.leadTimeMinutes / 60);
  const tierIsShort = tier === "SHORT" ? 1 : 0;
  const tierIsMedium = tier === "MEDIUM" ? 1 : 0;
  const tierIsLong = tier === "LONG" ? 1 : 0;

  return [
    1,
    physicalDailyKwhNorm,
    meanGhiNorm,
    meanCloudFrac,
    Math.sin(doyAngle),
    Math.cos(doyAngle),
    latitudeNorm,
    longitudeNorm,
    capacityNorm,
    leadDaysNorm,
    recentResidDailyNorm,
    regimeIsClear,
    regimeIsPartlyCloudy,
    regimeIsCloudy,
    regimeIsRapidlyChanging,
    tierIsShort,
    tierIsMedium,
    tierIsLong,
  ];
}

export { classifyHorizonTier };
export type { ForecastHorizonTier };
