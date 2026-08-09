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

export function interpolateWeatherAt(points: SolarWeatherPoint[], instant: Date): InterpolatedWeather | null {
  if (points.length === 0) {
    return null;
  }

  const t = instant.getTime();
  const sorted = points; // Both openMeteo.ts functions already return points in ascending time order.

  if (t <= sorted[0]!.time.getTime()) {
    const first = sorted[0]!;
    return { irradiance: first.irradiance, temperature: first.temperature };
  }

  const last = sorted[sorted.length - 1]!;
  if (t >= last.time.getTime()) {
    return { irradiance: last.irradiance, temperature: last.temperature };
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

  return { irradiance: last.irradiance, temperature: last.temperature };
}
