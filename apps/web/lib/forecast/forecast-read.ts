/**
 * Dashboard Forecast Architecture Correction milestone — the Dashboard's
 * ONLY connection to forecast data. Two cheap, indexed Prisma reads (find
 * the latest vintage's `issuedAt`, then fetch its rows) — never the
 * physical/weather/analog/glide-path engine, which only ever runs from the
 * scheduled route (`app/api/internal/forecast/refresh/route.ts`). This is
 * what makes a normal Dashboard render fast: DB reads only, no Open-Meteo
 * call, no calibration/analog-day query, no ensemble computation.
 */
import { prisma } from "@/lib/prisma";
import type { ForecastConfidence, ForecastHorizonTier } from "@/lib/forecast/forecast-tiers";

export type PersistedForecastInterval = {
  targetIntervalStart: Date;
  forecastKw: number;
  forecastKwh: number;
  horizonTier: ForecastHorizonTier;
  confidence: ForecastConfidence | null;
};

export type LatestForecastVintage = {
  issuedAt: Date;
  modelVersion: string;
  weatherSource: string;
  intervals: PersistedForecastInterval[];
};

/**
 * The most recently issued forecast vintage for a plant, in full (every
 * horizon tier, full ~35-day span — see `persistFullForecastVintage`'s own
 * doc comment for why the full horizon is persisted rather than just the
 * near-term portion). Returns `null` when the plant has no persisted
 * forecast yet (e.g. before the scheduled job's first run after this
 * migration ships) — the Dashboard degrades to a "Forecast unavailable"
 * state for that, per this milestone's explicit "never fall back to a
 * live computation" requirement; it never throws.
 */
export async function getLatestForecastVintage(plantId: string): Promise<LatestForecastVintage | null> {
  const latest = await prisma.pvForecastRecord
    .findFirst({
      where: { plantId },
      orderBy: { issuedAt: "desc" },
      select: { issuedAt: true },
    })
    .catch(() => null);

  if (!latest) {
    return null;
  }

  const rows = await prisma.pvForecastRecord
    .findMany({
      where: { plantId, issuedAt: latest.issuedAt },
      orderBy: { targetIntervalStart: "asc" },
      select: {
        targetIntervalStart: true,
        forecastKw: true,
        forecastKwh: true,
        horizonTier: true,
        confidence: true,
        modelVersion: true,
        weatherSource: true,
      },
    })
    .catch(() => []);

  if (rows.length === 0) {
    return null;
  }

  return {
    issuedAt: latest.issuedAt,
    modelVersion: rows[0]!.modelVersion,
    weatherSource: rows[0]!.weatherSource,
    intervals: rows.map((row) => ({
      targetIntervalStart: row.targetIntervalStart,
      forecastKw: row.forecastKw.toNumber(),
      forecastKwh: row.forecastKwh.toNumber(),
      horizonTier: row.horizonTier,
      confidence: row.confidence,
    })),
  };
}
