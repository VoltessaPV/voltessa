/**
 * PV Generation Forecast — physical solar-position layer.
 *
 * Implements the standard NOAA Solar Calculator algorithm (Spencer, J.W.
 * (1971), "Fourier series representation of the position of the sun",
 * Search, 2(5), 172 — the same closed-form Fourier-series approximation
 * NOAA's own solar position calculator and most lightweight solar-geometry
 * libraries use). There is no Python runtime in this repository to import
 * `pvlib` directly, and a full NREL SPA implementation is unnecessary for
 * forecast-grade (not survey-grade) accuracy — Spencer's formulas are
 * accurate to within about ±0.01° in declination and are the standard
 * "established formula" reference for this exact purpose.
 *
 * Everything here works directly from a UTC `Date` plus longitude, using
 * "true solar time" (UTC clock adjusted by longitude + the equation of
 * time) rather than a civil timezone offset — this is deliberate: it means
 * the plant's `timezone` field is never needed for the physics itself, only
 * for display.
 */

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function dayOfYearUtc(date: Date): number {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const diffMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - startOfYear;
  return Math.floor(diffMs / 86_400_000) + 1;
}

function fractionalYearRadians(date: Date): number {
  const dayOfYear = dayOfYearUtc(date);
  const hourFraction = (date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600 - 12) / 24;
  const daysInYear = (date.getUTCFullYear() % 4 === 0 && date.getUTCFullYear() % 100 !== 0) || date.getUTCFullYear() % 400 === 0 ? 366 : 365;
  return (2 * Math.PI) / daysInYear * (dayOfYear - 1 + hourFraction);
}

/** Equation of time, in minutes (Spencer 1971). */
function equationOfTimeMinutes(gamma: number): number {
  return (
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma))
  );
}

/** Solar declination, in radians (Spencer 1971). */
function solarDeclinationRadians(gamma: number): number {
  return (
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma)
  );
}

export type SolarPosition = {
  /** Degrees above the horizon; negative when the sun is below it (night). */
  elevationDeg: number;
  /** 0° = directly overhead, 90° = horizon. */
  zenithDeg: number;
  declinationRad: number;
};

/**
 * Solar position for one instant, at one location. `longitude` in degrees
 * east-positive, matching `Plant.longitude`'s stored convention (see
 * `lib/weather/openMeteo.ts`, which passes the same raw value straight to
 * Open-Meteo's own east-positive `longitude` parameter).
 */
export function solarPositionAt(date: Date, latitudeDeg: number, longitudeDeg: number): SolarPosition {
  const gamma = fractionalYearRadians(date);
  const eqTimeMinutes = equationOfTimeMinutes(gamma);
  const declinationRad = solarDeclinationRadians(gamma);

  const utcMinutesOfDay = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const trueSolarTimeMinutes = utcMinutesOfDay + eqTimeMinutes + 4 * longitudeDeg;
  // Each 4 minutes of true solar time = 1° of hour angle; solar noon (true
  // solar time 720 min) is hour angle 0.
  let hourAngleDeg = trueSolarTimeMinutes / 4 - 180;
  hourAngleDeg = ((hourAngleDeg + 180) % 360 + 360) % 360 - 180;
  const hourAngleRad = hourAngleDeg * DEG_TO_RAD;

  const latRad = latitudeDeg * DEG_TO_RAD;
  const cosZenith = Math.sin(latRad) * Math.sin(declinationRad) + Math.cos(latRad) * Math.cos(declinationRad) * Math.cos(hourAngleRad);
  const clampedCosZenith = Math.min(1, Math.max(-1, cosZenith));
  const zenithDeg = Math.acos(clampedCosZenith) * RAD_TO_DEG;

  return { elevationDeg: 90 - zenithDeg, zenithDeg, declinationRad };
}

/**
 * Sunrise/sunset for the UTC calendar day containing `date`, as UTC
 * instants. Returns `null` for polar day/night (never occurs for real
 * plant latitudes in this system, but handled rather than producing NaN).
 */
export function sunriseSunsetUtc(
  date: Date,
  latitudeDeg: number,
  longitudeDeg: number,
): { sunrise: Date; sunset: Date } | null {
  const midday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0));
  const gamma = fractionalYearRadians(midday);
  const eqTimeMinutes = equationOfTimeMinutes(gamma);
  const declinationRad = solarDeclinationRadians(gamma);

  const latRad = latitudeDeg * DEG_TO_RAD;
  const cosHourAngle = -Math.tan(latRad) * Math.tan(declinationRad);
  if (cosHourAngle <= -1 || cosHourAngle >= 1) {
    return null;
  }

  const hourAngleDeg = Math.acos(cosHourAngle) * RAD_TO_DEG;

  function utcInstantForTrueSolarTimeMinutes(trueSolarTimeMinutes: number): Date {
    const utcMinutesOfDay = trueSolarTimeMinutes - eqTimeMinutes - 4 * longitudeDeg;
    const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    return new Date(dayStart + utcMinutesOfDay * 60_000);
  }

  const sunrise = utcInstantForTrueSolarTimeMinutes((-hourAngleDeg + 180) * 4);
  const sunset = utcInstantForTrueSolarTimeMinutes((hourAngleDeg + 180) * 4);

  return { sunrise, sunset };
}

export function isDaylight(date: Date, latitudeDeg: number, longitudeDeg: number): boolean {
  return solarPositionAt(date, latitudeDeg, longitudeDeg).elevationDeg > 0;
}
