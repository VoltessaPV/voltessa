import { prisma } from "@/lib/prisma";
import { reconstructAvailablePv } from "@/lib/digital-twin/available-pv-reconstruction";
import { getHistoricalSolarWeather } from "@/lib/weather/openMeteo";
import { estimatePhysicalPvKw } from "@/lib/forecast/physical-pv-model";
import { interpolateWeatherAt } from "@/lib/forecast/weather-interpolation";
import { haurwitzClearSkyGhi } from "@/lib/forecast/clear-sky";
import { solarPositionAt } from "@/lib/forecast/solar-position";
import { classifyWeatherRegime, classifyHorizonTier, type WeatherRegime, type ForecastHorizonTier } from "@/lib/forecast/forecast-tiers";
import {
  buildFeatureVector,
  buildDailyFeatureVector,
  FEATURE_SCHEMA_VERSION,
  FEATURE_NAMES,
  DAILY_FEATURE_NAMES,
} from "@/lib/forecast/ml/feature-schema";
import { writeFileSync } from "node:fs";

/**
 * Multi-Horizon Self-Learning Forecast milestone. Exports a leakage-safe,
 * MULTI-HORIZON training dataset for `train.py`.
 *
 * For each historical target day D, builds training rows for THREE
 * representative simulated issuance points — 1, 5, and 20 days before D —
 * matching `forecast-tiers.ts`'s own SHORT (<=48h) / MEDIUM (<=10d) / LONG
 * (>10d) boundaries, never a second, separately-tuned set of horizon
 * buckets:
 *
 * - **SHORT** (simulated issuance 1 day before D): uses real historical
 *   weather for D as the forecast-weather proxy (the same disclosed
 *   limitation this project has used consistently — real archived
 *   forecasts aren't available, so historical actual weather stands in
 *   for what a real forecast would have shown, valid specifically because
 *   Open-Meteo's real forecast coverage genuinely reaches this lead time).
 * - **MEDIUM/LONG** (simulated issuance 5 or 20 days before D): uses NO
 *   real weather for D at all — `ghiWm2`/`cloudCoverPct` are the same
 *   clear-sky-fallback values `weatherOrClearSkyFallback` computes in
 *   production for a day beyond real forecast coverage, and
 *   `weatherRegime` is honestly `UNKNOWN`. This is the structural fix for
 *   "do not allow a feature unavailable at a given horizon to leak into
 *   that forecast" — MEDIUM/LONG rows simply do not have real weather
 *   features to leak, exactly matching what the physical pipeline itself
 *   already does for these tiers.
 *
 * All three scenarios share the same real ACTUAL production for day D
 * (the label — always legitimate hindsight, never a feature) but differ
 * in `leadTimeMinutes`/`horizonTier` and in `recentResidualKw`/
 * `recentResidualDailyKwh`, each computed from the walk-forward history
 * strictly before ITS OWN simulated issuance point, not before D itself -
 * a SHORT-tier row issued "yesterday" and a LONG-tier row issued "20 days
 * ago" legitimately see different amounts of prior history.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_BIAS_WINDOW_DAYS = 5;
const TRUE_VINTAGE_WEIGHT = 1.0;
const RETROSPECTIVE_REPLAY_WEIGHT = 0.3;
const FALLBACK_AMBIENT_TEMP_C = 20;

/** Representative simulated lead times (days before the target day), one per horizon tier boundary. */
const SIMULATED_LEAD_DAYS: { leadDays: number; label: ForecastHorizonTier }[] = [
  { leadDays: 1, label: "SHORT" },
  { leadDays: 5, label: "MEDIUM" },
  { leadDays: 20, label: "LONG" },
];

type DataSource = "TRUE_VINTAGE" | "RETROSPECTIVE_REPLAY";

type IntervalRow = {
  features: number[];
  label: number;
  plantId: string;
  date: string;
  timestamp: string;
  dataSource: DataSource;
  sourceWeight: number;
  weatherRegime: WeatherRegime;
  horizonTier: ForecastHorizonTier;
  actualKw: number;
  physicalKw: number;
  capacityKw: number;
};

type DailyRow = {
  features: number[];
  label: number;
  plantId: string;
  date: string;
  dataSource: DataSource;
  sourceWeight: number;
  weatherRegime: WeatherRegime;
  horizonTier: ForecastHorizonTier;
  actualDailyKwh: number;
  physicalDailyKwh: number;
};

type BaseInterval = { timestamp: Date; actualKw: number };

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

/** The exact clear-sky-fallback formula `weatherOrClearSkyFallback` uses in production, for a day with no real weather at issuance. */
function clearSkyFallbackInterval(timestamp: Date, latitude: number, longitude: number, capacityKw: number, actualKw: number) {
  const { zenithDeg, elevationDeg } = solarPositionAt(timestamp, latitude, longitude);
  const clearSkyGhi = haurwitzClearSkyGhi(zenithDeg);
  const physical = estimatePhysicalPvKw({ timestamp, latitude, longitude, ghiWm2: clearSkyGhi, ambientTempC: FALLBACK_AMBIENT_TEMP_C, capacityKw });
  return { timestamp, physicalKw: physical.forecastKw, actualKw, ghiWm2: clearSkyGhi, ambientTempC: FALLBACK_AMBIENT_TEMP_C, elevationDeg, clearSkyIndex: 0, cloudCoverPct: null as number | null };
}

async function main() {
  const plants = await prisma.plant.findMany({
    where: { latitude: { not: null }, longitude: { not: null }, capacityKw: { not: null } },
    select: { id: true, organizationId: true, name: true, latitude: true, longitude: true, capacityKw: true },
  });

  const today = new Date();
  const walkForwardStart = new Date(Date.UTC(2026, 6, 8));
  const walkForwardEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const days: string[] = [];
  for (let t = walkForwardStart.getTime(); t < walkForwardEnd.getTime(); t += DAY_MS) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }

  const intervalRows: IntervalRow[] = [];
  const dailyRows: DailyRow[] = [];
  let trueVintageDays = 0;
  let replayDays = 0;
  const tierRowCounts: Record<ForecastHorizonTier, number> = { SHORT: 0, MEDIUM: 0, LONG: 0 };

  for (const plant of plants) {
    const latitude = Number(plant.latitude);
    const longitude = Number(plant.longitude);
    const capacityKw = Number(plant.capacityKw);

    // Walk-forward recent-bias history, keyed by real calendar date - shared across all
    // lead-time scenarios, filtered per-scenario to "strictly before THIS scenario's own
    // simulated issuance point" below.
    const dailyResidualHistory: { date: string; residualKwh: number }[] = [];

    for (const date of days) {
      const dayStart = new Date(`${date}T00:00:00.000Z`);
      const dayEnd = new Date(dayStart.getTime() + DAY_MS);

      const trueVintageRows = await prisma.pvForecastRecord.findMany({
        where: { plantId: plant.id, targetIntervalStart: { gte: dayStart, lt: dayEnd }, actualKwh: { not: null } },
        orderBy: { targetIntervalStart: "asc" },
      });
      const isTrueVintage = trueVintageRows.length === 96;
      const dataSource: DataSource = isTrueVintage ? "TRUE_VINTAGE" : "RETROSPECTIVE_REPLAY";
      const sourceWeight = isTrueVintage ? TRUE_VINTAGE_WEIGHT : RETROSPECTIVE_REPLAY_WEIGHT;
      if (isTrueVintage) trueVintageDays += 1;
      else replayDays += 1;

      // ---------- Build the SHORT-tier (real-weather-proxy) base for this day ----------
      let shortInterval: { timestamp: Date; physicalKw: number; actualKw: number; ghiWm2: number; ambientTempC: number; elevationDeg: number; clearSkyIndex: number; cloudCoverPct: number | null }[] = [];
      let dayMeanGhi = 0;
      let dayMeanCloud: number | null = null;
      let dayRegimeShort: WeatherRegime = "UNKNOWN";

      if (isTrueVintage) {
        shortInterval = trueVintageRows.map((row) => {
          const inputs = row.inputs as { physicalWeatherKw?: number; ghiWm2?: number; ambientTempC?: number; cloudCoverPct?: number | null };
          const ghiWm2 = inputs.ghiWm2 ?? 0;
          const { zenithDeg, elevationDeg } = solarPositionAt(row.targetIntervalStart, latitude, longitude);
          const clearSkyGhi = haurwitzClearSkyGhi(zenithDeg);
          const clearSkyIndex = clearSkyGhi > 0 ? Math.min(1.2, Math.max(0, ghiWm2) / clearSkyGhi) : 0;
          return {
            timestamp: row.targetIntervalStart,
            physicalKw: inputs.physicalWeatherKw ?? 0,
            actualKw: row.actualKwh!.toNumber() / 0.25,
            ghiWm2,
            ambientTempC: inputs.ambientTempC ?? 20,
            elevationDeg,
            clearSkyIndex,
            cloudCoverPct: inputs.cloudCoverPct ?? null,
          };
        });
        const cloudSamples = shortInterval.map((p) => p.cloudCoverPct).filter((c): c is number => c !== null);
        dayMeanCloud = cloudSamples.length > 0 ? cloudSamples.reduce((s, c) => s + c, 0) / cloudSamples.length : null;
        dayMeanGhi = shortInterval.reduce((s, p) => s + p.ghiWm2, 0) / shortInterval.length;
        const firstInputs = trueVintageRows[0]!.inputs as { weatherRegime?: WeatherRegime };
        dayRegimeShort = firstInputs.weatherRegime ?? "UNKNOWN";
      } else {
        const [weatherPoints, actualIntervals] = await Promise.all([
          getHistoricalSolarWeather(latitude, longitude, dayStart, dayEnd).catch(() => []),
          reconstructAvailablePv({ plantId: plant.id, organizationId: plant.organizationId, start: dayStart, end: dayEnd }),
        ]);
        if (weatherPoints.length === 0) continue;

        const actualByBucket = new Map<number, number>();
        for (const iv of actualIntervals) {
          const b = Math.floor(iv.intervalStart.getTime() / (15 * 60 * 1000)) * (15 * 60 * 1000);
          actualByBucket.set(b, (actualByBucket.get(b) ?? 0) + (iv.availablePvKwh ?? 0));
        }
        if (actualByBucket.size === 0) continue;

        for (let t = dayStart.getTime(); t < dayEnd.getTime(); t += 15 * 60 * 1000) {
          const timestamp = new Date(t);
          const weather = interpolateWeatherAt(weatherPoints, timestamp);
          const { zenithDeg, elevationDeg } = solarPositionAt(timestamp, latitude, longitude);
          const clearSkyGhi = haurwitzClearSkyGhi(zenithDeg);
          const ghiWm2 = weather?.irradiance ?? clearSkyGhi;
          const ambientTempC = weather?.temperature ?? 20;
          const cloudCoverPct = weather?.cloudCover ?? null;
          const physical = estimatePhysicalPvKw({ timestamp, latitude, longitude, ghiWm2, ambientTempC, capacityKw });
          const actualKwh = actualByBucket.get(t) ?? 0;
          shortInterval.push({ timestamp, physicalKw: physical.forecastKw, actualKw: actualKwh / 0.25, ghiWm2, ambientTempC, elevationDeg, clearSkyIndex: physical.clearSkyIndex, cloudCoverPct });
        }
        const cloudSamples = shortInterval.map((p) => p.cloudCoverPct).filter((c): c is number => c !== null);
        dayMeanCloud = cloudSamples.length > 0 ? cloudSamples.reduce((s, c) => s + c, 0) / cloudSamples.length : null;
        dayMeanGhi = shortInterval.reduce((s, p) => s + p.ghiWm2, 0) / shortInterval.length;
        const volatility = cloudSamples.length > 1 ? Math.sqrt(cloudSamples.reduce((s, c) => s + (c - (dayMeanCloud ?? 0)) ** 2, 0) / cloudSamples.length) : null;
        dayRegimeShort = classifyWeatherRegime({ meanCloudCoverPct: dayMeanCloud, cloudVolatility: volatility });
      }

      if (shortInterval.length === 0) continue;

      const baseIntervals: BaseInterval[] = shortInterval.map((p) => ({ timestamp: p.timestamp, actualKw: p.actualKw }));

      // ---------- Emit rows for all 3 representative lead-time scenarios ----------
      for (const { leadDays, label } of SIMULATED_LEAD_DAYS) {
        const simulatedIssuedAt = new Date(dayStart.getTime() - leadDays * DAY_MS);

        const perIntervalForTier =
          label === "SHORT"
            ? shortInterval
            : baseIntervals.map((b) => clearSkyFallbackInterval(b.timestamp, latitude, longitude, capacityKw, b.actualKw));
        const tierRegime = label === "SHORT" ? dayRegimeShort : "UNKNOWN";
        const tierMeanGhi = label === "SHORT" ? dayMeanGhi : perIntervalForTier.reduce((s, p) => s + p.ghiWm2, 0) / perIntervalForTier.length;
        const tierMeanCloud = label === "SHORT" ? dayMeanCloud : null;

        // Walk-forward-safe recent bias AS OF this scenario's own simulated issuance point -
        // a LONG-tier row issued 20 days early sees 20 fewer days of history than a SHORT-tier
        // row for the same target day, exactly as it would in reality.
        const historyAsOfIssuance = dailyResidualHistory.filter((h) => new Date(`${h.date}T00:00:00.000Z`).getTime() < simulatedIssuedAt.getTime());
        const recentWindow = historyAsOfIssuance.slice(-RECENT_BIAS_WINDOW_DAYS);
        const recentResidualDailyKwh = recentWindow.length > 0 ? median(recentWindow.map((d) => d.residualKwh)) : 0;
        const recentResidualKw = recentResidualDailyKwh / 24;

        const physicalDailyKwh = perIntervalForTier.reduce((s, p) => s + p.physicalKw * 0.25, 0);
        const actualDailyKwh = perIntervalForTier.reduce((s, p) => s + p.actualKw * 0.25, 0);

        for (const p of perIntervalForTier) {
          const leadTimeMinutes = (p.timestamp.getTime() - simulatedIssuedAt.getTime()) / 60_000;
          const actualTier = classifyHorizonTier(leadTimeMinutes / 60);
          const features = buildFeatureVector({
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
            leadTimeMinutes,
            weatherRegime: tierRegime,
            recentResidualKw,
          });
          intervalRows.push({
            features,
            label: p.actualKw - p.physicalKw,
            plantId: plant.id,
            date,
            timestamp: p.timestamp.toISOString(),
            dataSource: label === "SHORT" ? dataSource : "RETROSPECTIVE_REPLAY", // MEDIUM/LONG never have a true-vintage counterpart today
            sourceWeight: label === "SHORT" ? sourceWeight : RETROSPECTIVE_REPLAY_WEIGHT,
            weatherRegime: tierRegime,
            horizonTier: actualTier,
            actualKw: p.actualKw,
            physicalKw: p.physicalKw,
            capacityKw,
          });
          tierRowCounts[actualTier] += 1;
        }

        const dailyLeadTimeMinutes = (dayStart.getTime() - simulatedIssuedAt.getTime()) / 60_000;
        const dailyFeatures = buildDailyFeatureVector({
          date: dayStart,
          physicalDailyKwh,
          capacityKw,
          meanGhiWm2: tierMeanGhi,
          meanCloudCoverPct: tierMeanCloud,
          latitude,
          longitude,
          weatherRegime: tierRegime,
          leadTimeMinutes: dailyLeadTimeMinutes,
          recentResidualDailyKwh,
        });
        dailyRows.push({
          features: dailyFeatures,
          label: actualDailyKwh - physicalDailyKwh,
          plantId: plant.id,
          date,
          dataSource: label === "SHORT" ? dataSource : "RETROSPECTIVE_REPLAY",
          sourceWeight: label === "SHORT" ? sourceWeight : RETROSPECTIVE_REPLAY_WEIGHT,
          weatherRegime: tierRegime,
          horizonTier: classifyHorizonTier(dailyLeadTimeMinutes / 60),
          actualDailyKwh,
          physicalDailyKwh,
        });
      }

      // Admit this day's own SHORT-tier-based residual into history AFTER all 3 scenarios for
      // this target day have been built - never before, preserving walk-forward discipline.
      const shortPhysicalDailyKwh = shortInterval.reduce((s, p) => s + p.physicalKw * 0.25, 0);
      const shortActualDailyKwh = shortInterval.reduce((s, p) => s + p.actualKw * 0.25, 0);
      dailyResidualHistory.push({ date, residualKwh: shortActualDailyKwh - shortPhysicalDailyKwh });
    }
  }

  const output = {
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    intervalFeatureNames: FEATURE_NAMES,
    dailyFeatureNames: DAILY_FEATURE_NAMES,
    exportedAt: new Date().toISOString(),
    plantCount: plants.length,
    dayCount: days.length,
    trueVintageDays,
    replayDays,
    tierRowCounts,
    intervalRows,
    dailyRows,
  };

  const outPath = "D:/Development/Voltessa/platform/ml-forecasting/data/training-dataset.json";
  writeFileSync(outPath, JSON.stringify(output));
  console.log(`Exported ${intervalRows.length} interval rows (${JSON.stringify(tierRowCounts)}), ${dailyRows.length} daily rows.`);
  console.log(`True vintage days: ${trueVintageDays}, retrospective replay days: ${replayDays}.`);
  console.log(`Written to ${outPath}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
