import type { SolarWeatherPoint } from "@/lib/weather/openMeteo";

/**
 * PV Generation Forecast — shared weather interpolation.
 *
 * Open-Meteo (both endpoints) only ever returns hourly points; the forecast
 * itself runs at 15-minute resolution, so every consumer needs the same
 * "irradiance/temperature at an arbitrary instant between two hourly
 * samples" logic. Linear interpolation between the two bracketing hours —
 * irradiance genuinely does move roughly linearly hour-to-hour outside of
 * fast-moving cloud transients this data source can't resolve at sub-hourly
 * detail anyway.
 */
export type InterpolatedWeather = { irradiance: number; temperature: number };

/**
 * Dashboard Week/Month Forecast Correction milestone — fixes a real bug
 * found while investigating why the persisted forecast went flat/zero
 * beyond ~48h: Open-Meteo's hourly forecast array only covers a couple of
 * days (confirmed: 48 points, i.e. 2 days, for the real forecast
 * endpoint). Every timestamp beyond that coverage window used to fall into
 * the `t >= last.time` branch below and silently hold the LAST real
 * sample's reading forever — since the last sample is usually a
 * late-evening/near-zero reading, every day beyond real weather coverage
 * got clamped to that same near-zero value for its entire 24 hours,
 * instead of ever reaching `weatherOrClearSkyFallback`'s intended
 * clear-sky fallback (`usedFallback: false` was reported even though there
 * was, in truth, no real information for that instant at all). `points`
 * genuinely having zero length was the only case this ever returned
 * `null` for — an out-of-range instant with a non-empty array always got a
 * fabricated-by-clamping value instead.
 *
 * The fix: still hold the nearest edge sample for a small grace window
 * (one real sampling interval — the gap between the two edge points
 * themselves, or 60 minutes if there's only one point) to cover the
 * ordinary "now is a few minutes past the top of the hour" case this
 * function was designed for, but report `null` beyond that, so
 * `weatherOrClearSkyFallback` (unchanged) correctly falls through to its
 * own already-existing Haurwitz clear-sky estimate for every instant this
 * data source genuinely has no coverage for. No physical equation,
 * calibration weight, or analog-day methodology is touched — this only
 * fixes *whether real weather data is honestly reported as available*.
 */
export function interpolateWeatherAt(points: SolarWeatherPoint[], instant: Date): InterpolatedWeather | null {
  if (points.length === 0) {
    return null;
  }

  const t = instant.getTime();
  const sorted = points; // Both openMeteo.ts functions already return points in ascending time order.
  const graceMs = sorted.length > 1 ? sorted[1]!.time.getTime() - sorted[0]!.time.getTime() : 60 * 60 * 1000;

  const first = sorted[0]!;
  if (t <= first.time.getTime()) {
    return t >= first.time.getTime() - graceMs ? { irradiance: first.irradiance, temperature: first.temperature } : null;
  }

  const last = sorted[sorted.length - 1]!;
  if (t >= last.time.getTime()) {
    return t <= last.time.getTime() + graceMs ? { irradiance: last.irradiance, temperature: last.temperature } : null;
  }

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const before = sorted[i]!;
    const after = sorted[i + 1]!;
    const beforeTime = before.time.getTime();
    const afterTime = after.time.getTime();

    if (t >= beforeTime && t <= afterTime) {
      const span = afterTime - beforeTime;
      const fraction = span === 0 ? 0 : (t - beforeTime) / span;
      return {
        irradiance: before.irradiance + (after.irradiance - before.irradiance) * fraction,
        temperature: before.temperature + (after.temperature - before.temperature) * fraction,
      };
    }
  }

  return null;
}
