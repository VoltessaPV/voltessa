import { reconstructAvailablePv } from "@/lib/digital-twin/available-pv-reconstruction";
import { estimatePhysicalPvKw } from "@/lib/forecast/physical-pv-model";
import { haurwitzClearSkyGhi } from "@/lib/forecast/clear-sky";
import { solarPositionAt } from "@/lib/forecast/solar-position";
import { interpolateWeatherAt } from "@/lib/forecast/weather-interpolation";
import { classifyWeatherRegime, classifyHorizonTier, type WeatherRegime, type ForecastHorizonTier } from "@/lib/forecast/forecast-tiers";
import { buildFeatureVector, buildDailyFeatureVector, FEATURE_SCHEMA_VERSION } from "@/lib/forecast/ml/feature-schema";
import { getCurrentChampion } from "@/lib/forecast/ml/model-registry";
import { runOnnxInference } from "@/lib/forecast/ml/onnx-inference-client";
import { DEFAULT_EXTENDED_HORIZON_DAYS } from "@/lib/forecast/pv-forecast-engine";
import { getSolarWeather, type SolarWeatherPoint } from "@/lib/weather/openMeteo";

/**
 * Multi-Horizon Self-Learning Forecast milestone — live ML forecast
 * generation. Loads the current CHAMPION's two ONNX artifacts (magnitude +
 * shape) from `ForecastModelVersion`, builds every feature vector locally
 * (unchanged from before), then delegates only the actual ONNX inference
 * call to the standalone ONNX Inference Service running on the Scaleway VM
 * via `onnx-inference-client.ts` — onnxruntime-node's native binary does
 * not load in Vercel's serverless runtime (confirmed in production), so
 * this is the one piece of this pipeline that cannot run here directly.
 * Everything else (weather fetch, physical model, feature building,
 * two-stage rescale/bounding) is unchanged and still runs in this process.
 * Applies the two-stage combination validated offline in
 * `ml-forecasting/train.py`, for EVERY day from D+1 through
 * `DEFAULT_EXTENDED_HORIZON_DAYS` — the same full-horizon span the
 * physical+hand-tuned pipeline already persists (`pv-forecast-engine.ts`),
 * not a D+1-only model. D+1 gets no special code path here; it gets the
 * strongest signal because its own features (real weather, small
 * `leadNorm`) are the ones the model was trained to trust most — the
 * model learns that distinction from `tierIsShort/Medium/Long` and
 * `leadDaysNorm`, per `feature-schema.ts`'s own design.
 *
 * Per-day weather-source honesty mirrors `pv-forecast-engine.ts` exactly:
 * a day within Open-Meteo's real forecast coverage gets `hasRealWeather`
 * classification and a real `weatherRegime`; a day beyond it gets
 * `UNKNOWN` regime and clear-sky-fallback GHI, never a fabricated
 * forecast that far out — the same honesty the exporter's own multi-
 * horizon training data already encodes (see
 * `scripts/ml/export-training-dataset.ts`), so inference never asks the
 * model to use information it was never trained to expect at that lead
 * time either.
 *
 * The two-stage rescale (Stage 2's per-interval predictions scaled to
 * match Stage 1's daily target) happens INDEPENDENTLY per calendar day —
 * each day has its own daily-energy target, never blended across days.
 *
 * Deliberately produces a SEPARATE result from `generatePvForecastCore`'s
 * physical+hand-tuned output - this function never writes to
 * `PvForecastRecord` and is never called from the Dashboard's render path.
 * See `app/api/internal/forecast/ml-refresh/route.ts` for the only caller.
 */

const RECENT_BIAS_WINDOW_DAYS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const INTERVAL_MS = 15 * 60 * 1000;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

async function computeRecentResidual(params: {
  plantId: string;
  organizationId: string;
  latitude: number;
  longitude: number;
  capacityKw: number;
  asOf: Date; // issuance instant - only days strictly before this are ever used
}): Promise<{ recentResidualDailyKwh: number; recentResidualKw: number }> {
  const { plantId, organizationId, latitude, longitude, capacityKw, asOf } = params;
  const residuals: number[] = [];

  for (let i = 1; i <= RECENT_BIAS_WINDOW_DAYS; i += 1) {
    const dayStart = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()) - i * DAY_MS);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    if (dayEnd.getTime() > asOf.getTime()) continue;

    const actualIntervals = await reconstructAvailablePv({ plantId, organizationId, start: dayStart, end: dayEnd }).catch(() => []);
    if (actualIntervals.length === 0) continue;
    const actualDailyKwh = actualIntervals.reduce((s, iv) => s + (iv.availablePvKwh ?? 0), 0);

    let physicalDailyKwh = 0;
    for (let t = dayStart.getTime(); t < dayEnd.getTime(); t += INTERVAL_MS) {
      const timestamp = new Date(t);
      const { zenithDeg } = solarPositionAt(timestamp, latitude, longitude);
      const clearSkyGhi = haurwitzClearSkyGhi(zenithDeg);
      const physical = estimatePhysicalPvKw({ timestamp, latitude, longitude, ghiWm2: clearSkyGhi, ambientTempC: 20, capacityKw });
      physicalDailyKwh += physical.forecastKw * 0.25;
    }

    residuals.push(actualDailyKwh - physicalDailyKwh);
  }

  const recentResidualDailyKwh = residuals.length > 0 ? median(residuals) : 0;
  return { recentResidualDailyKwh, recentResidualKw: recentResidualDailyKwh / 24 };
}

export type MlForecastInterval = {
  timestamp: Date;
  physicalForecastKw: number;
  mlForecastKw: number;
  mlForecastKwh: number;
  weatherRegime: WeatherRegime;
  horizonTier: ForecastHorizonTier;
  leadTimeMinutes: number;
  featureVector: number[];
};

export type MlForecastResult = {
  modelVersionId: string;
  intervals: MlForecastInterval[];
};

/**
 * Generates the full multi-horizon ML forecast (D+1 through
 * `horizonDays`) for one plant, using the current champion model. Returns
 * `null` if no champion exists yet - callers must never fabricate a
 * forecast in that case.
 */
export async function generateMlForecast(params: {
  plantId: string;
  organizationId: string;
  latitude: number;
  longitude: number;
  capacityKw: number;
  issuedAt: Date;
  horizonDays?: number;
}): Promise<MlForecastResult | null> {
  const { plantId, organizationId, latitude, longitude, capacityKw, issuedAt, horizonDays = DEFAULT_EXTENDED_HORIZON_DAYS } = params;

  const champion = await getCurrentChampion();
  if (!champion) return null;
  if (champion.featureSchemaVersion !== FEATURE_SCHEMA_VERSION) {
    throw new Error(
      `Champion model ${champion.versionLabel} was trained against feature schema ${champion.featureSchemaVersion}, but the running code is on ${FEATURE_SCHEMA_VERSION} - refusing to run inference on a mismatched feature vector rather than guessing.`,
    );
  }

  const horizonStart = new Date(Date.UTC(issuedAt.getUTCFullYear(), issuedAt.getUTCMonth(), issuedAt.getUTCDate()) + DAY_MS);

  const [weather, recentResidual] = await Promise.all([
    getSolarWeather(latitude, longitude).catch(() => null),
    computeRecentResidual({ plantId, organizationId, latitude, longitude, capacityKw, asOf: issuedAt }),
  ]);
  const weatherPoints: SolarWeatherPoint[] = weather?.hourly ?? [];

  type Pre = {
    timestamp: Date;
    physicalKw: number;
    ghiWm2: number;
    ambientTempC: number;
    elevationDeg: number;
    clearSkyIndex: number;
    cloudCoverPct: number | null;
    dayStart: Date;
    weatherRegime: WeatherRegime;
  };
  const allIntervals: Pre[] = [];
  const dailyMeta: { dayStart: Date; physicalDailyKwh: number; meanGhi: number; meanCloud: number | null; weatherRegime: WeatherRegime }[] = [];

  for (let d = 0; d < horizonDays; d += 1) {
    const dayStart = new Date(horizonStart.getTime() + d * DAY_MS);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);

    // Same per-day real-weather-coverage honesty pv-forecast-engine.ts already uses in production.
    const dayPoints = weatherPoints.filter((p) => p.time.getTime() >= dayStart.getTime() && p.time.getTime() < dayEnd.getTime());
    const hasRealWeather = dayPoints.length > 0;
    const meanCloud = hasRealWeather ? dayPoints.reduce((s, p) => s + p.cloudCover, 0) / dayPoints.length : null;
    const cloudVolatility = hasRealWeather ? stddev(dayPoints.map((p) => p.cloudCover)) : null;
    const weatherRegime = classifyWeatherRegime({ meanCloudCoverPct: meanCloud, cloudVolatility });

    const dayIntervals: Pre[] = [];
    for (let t = dayStart.getTime(); t < dayEnd.getTime(); t += INTERVAL_MS) {
      const timestamp = new Date(t);
      const interpolated = interpolateWeatherAt(weatherPoints, timestamp);
      const { zenithDeg, elevationDeg } = solarPositionAt(timestamp, latitude, longitude);
      const clearSkyGhi = haurwitzClearSkyGhi(zenithDeg);
      const ghiWm2 = interpolated?.irradiance ?? clearSkyGhi;
      const ambientTempC = interpolated?.temperature ?? 20;
      const cloudCoverPct = interpolated?.cloudCover ?? null;
      const physical = estimatePhysicalPvKw({ timestamp, latitude, longitude, ghiWm2, ambientTempC, capacityKw });
      dayIntervals.push({ timestamp, physicalKw: physical.forecastKw, ghiWm2, ambientTempC, elevationDeg, clearSkyIndex: physical.clearSkyIndex, cloudCoverPct, dayStart, weatherRegime });
    }

    const physicalDailyKwh = dayIntervals.reduce((s, p) => s + p.physicalKw * 0.25, 0);
    const meanGhi = dayIntervals.reduce((s, p) => s + p.ghiWm2, 0) / dayIntervals.length;
    dailyMeta.push({ dayStart, physicalDailyKwh, meanGhi, meanCloud, weatherRegime });
    allIntervals.push(...dayIntervals);
  }

  const intervalFeatures = allIntervals.map((p) =>
    buildFeatureVector({
      timestamp: p.timestamp,
      physicalWeatherKw: p.physicalKw,
      capacityKw,
      ghiWm2: p.ghiWm2,
      ambientTempC: p.ambientTempC,
      elevationDeg: p.elevationDeg,
      clearSkyIndex: p.clearSkyIndex,
      cloudCoverPct: p.cloudCoverPct,
      latitude,
      longitude,
      leadTimeMinutes: (p.timestamp.getTime() - issuedAt.getTime()) / 60_000,
      weatherRegime: p.weatherRegime,
      recentResidualKw: recentResidual.recentResidualKw,
    }),
  );

  const dailyFeatures = dailyMeta.map((d) =>
    buildDailyFeatureVector({
      date: d.dayStart,
      physicalDailyKwh: d.physicalDailyKwh,
      capacityKw,
      meanGhiWm2: d.meanGhi,
      meanCloudCoverPct: d.meanCloud,
      latitude,
      longitude,
      weatherRegime: d.weatherRegime,
      leadTimeMinutes: (d.dayStart.getTime() - issuedAt.getTime()) / 60_000,
      recentResidualDailyKwh: recentResidual.recentResidualDailyKwh,
    }),
  );

  // One batched inference call across every day, not one call per day - trivial cost for a small
  // tree model, avoids repeating the ONNX Inference Service round-trip `horizonDays` times.
  const { magnitudeCorrectionsKwh, shapeCorrectionsKw } = await runOnnxInference({
    magnitudeModelOnnx: champion.magnitudeModelOnnx,
    shapeModelOnnx: champion.shapeModelOnnx,
    dailyFeatures,
    intervalFeatures,
  });

  const intervals: MlForecastInterval[] = [];
  let intervalIndex = 0;
  for (let d = 0; d < dailyMeta.length; d += 1) {
    const day = dailyMeta[d]!;
    const dayEnd = new Date(day.dayStart.getTime() + DAY_MS);
    const dayIntervals = allIntervals.filter((p) => p.dayStart.getTime() === day.dayStart.getTime());

    const rawShaped = dayIntervals.map((p, i) => Math.max(0, p.physicalKw + (shapeCorrectionsKw[intervalIndex + i] ?? 0)));
    const rawShapedDailyKwh = rawShaped.reduce((s, kw) => s + kw * 0.25, 0);
    const targetDailyKwh = Math.max(0, day.physicalDailyKwh + (magnitudeCorrectionsKwh[d] ?? 0));
    const rescale = rawShapedDailyKwh > 0.01 ? targetDailyKwh / rawShapedDailyKwh : 1;

    for (let i = 0; i < dayIntervals.length; i += 1) {
      const p = dayIntervals[i]!;
      const leadTimeMinutes = (p.timestamp.getTime() - issuedAt.getTime()) / 60_000;
      // Night is structural, not statistical - the same guarantee `pv-forecast-core.ts` already
      // enforces for the physical+hand-tuned pipeline: no learned correction may ever push a
      // night interval above zero. `elevationDeg` (not `physicalKw`) is the correct test.
      const mlForecastKw = p.elevationDeg <= 0 ? 0 : Math.min(capacityKw, Math.max(0, rawShaped[i]! * rescale));
      intervals.push({
        timestamp: p.timestamp,
        physicalForecastKw: p.physicalKw,
        mlForecastKw,
        mlForecastKwh: mlForecastKw * 0.25,
        weatherRegime: p.weatherRegime,
        horizonTier: classifyHorizonTier(leadTimeMinutes / 60),
        leadTimeMinutes,
        featureVector: intervalFeatures[intervalIndex + i]!,
      });
    }
    intervalIndex += dayIntervals.length;
    void dayEnd;
  }

  return { modelVersionId: champion.id, intervals };
}
