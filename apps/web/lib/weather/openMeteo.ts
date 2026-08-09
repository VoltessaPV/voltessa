/**
 * Open-Meteo Forecast API provider — solar-relevant weather for the active
 * plant. Open-Meteo requires no API key/credential (unlike FusionSolar or
 * ENTSO-E), so there is no new env var to declare here — see CLAUDE.md's
 * Configuration section, which lists every real env var this app reads.
 *
 * This module owns everything specific to Open-Meteo: the request shape and
 * parsing its JSON response. Nothing outside `lib/weather/` should ever see
 * Open-Meteo's raw field names (`shortwave_radiation`, `cloud_cover`, ...) —
 * every consumer, including every UI component, depends only on
 * `SolarWeather` below. That boundary is what lets a future swap to
 * Solcast, Meteomatics, or PVGIS (or adding production-forecast/expected-
 * peak-irradiance fields) replace this file alone, without touching the UI.
 *
 * Only the fields this app actually needs for PV-relevant weather are
 * requested — no humidity, pressure, visibility, UV, dew point, sunrise, or
 * sunset, none of which anything here reads. `weather_code` (Open-Meteo's
 * WMO weather code) is the one exception to "no precipitation": it isn't
 * used for anything PV-related, only to let the Solar Weather widget's icon
 * show an actual storm/snow/rain/fog event when one is happening, instead
 * of always deriving the icon from cloud cover alone — see
 * `components/dashboard/WeatherIcons.tsx` and `WeatherCard.tsx`'s
 * `solarCondition`.
 */

const OPEN_METEO_BASE_URL = "https://api.open-meteo.com/v1/forecast";
/**
 * Open-Meteo's own historical-observations sibling API — same provider,
 * same hourly field names/units, different host (Open-Meteo splits
 * forecast and archive data across two endpoints). Used only by
 * `getHistoricalSolarWeather` below, for the PV forecast engine's
 * calibration/analog-day/backtest needs (`lib/forecast/*`) — genuine
 * walk-forward backtesting requires real historical irradiance for days
 * that have already happened, which the forecast endpoint (max
 * `forecast_days`) cannot provide.
 */
const OPEN_METEO_ARCHIVE_BASE_URL = "https://archive-api.open-meteo.com/v1/archive";
const HOURLY_FIELDS = [
  "shortwave_radiation",
  "cloud_cover",
  "temperature_2m",
  "wind_speed_10m",
  "weather_code",
] as const;
/** Enough hourly points ahead to always cover the next 6-8 hours, even late in the day. */
const FORECAST_DAYS = 2;
/** ~10-15 minutes, per this widget's own freshness requirement — there is no reason to call Open-Meteo on every Dashboard render. */
const WEATHER_CACHE_REVALIDATE_SECONDS = 900;
/** Historical archive data never changes once published — safe to cache far longer than the live forecast. */
const ARCHIVE_CACHE_REVALIDATE_SECONDS = 86_400;

export class OpenMeteoApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenMeteoApiError";
  }
}

/** One hour of solar-relevant weather. */
export type SolarWeatherPoint = {
  time: Date;
  /** Open-Meteo's `shortwave_radiation` (W/m², global horizontal irradiance) — the single most PV-relevant figure this API offers, standing in for "how much sun is actually reaching the panels" the way a generic weather icon/code never can. */
  irradiance: number;
  /** Percent, 0-100. */
  cloudCover: number;
  /** Degrees Celsius. */
  temperature: number;
  /** Meters per second. */
  windSpeed: number;
  /** Open-Meteo's WMO weather code — icon-severity override only, see module doc comment. */
  weatherCode: number;
};

/**
 * This app's own internal weather model — never Open-Meteo's raw response
 * shape (see module doc comment). `current` is the hourly point nearest to
 * "now"; `hourly` is the full forecast this call returned, for the UI to
 * slice however it needs (e.g. the next 6-8 hours).
 */
export type SolarWeather = {
  current: {
    irradiance: number;
    cloudCover: number;
    temperature: number;
    windSpeed: number;
    weatherCode: number;
  };
  hourly: SolarWeatherPoint[];
};

type OpenMeteoHourlyResponse = {
  time: string[];
  shortwave_radiation: number[];
  cloud_cover: number[];
  temperature_2m: number[];
  wind_speed_10m: number[];
  weather_code: number[];
};

function isOpenMeteoHourlyResponse(
  value: unknown,
): value is OpenMeteoHourlyResponse {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    Array.isArray(candidate.time) &&
    HOURLY_FIELDS.every((field) => Array.isArray(candidate[field]))
  );
}

/** Nearest hourly point to `now` (by absolute time difference) — the "current forecast hour" the Solar Weather card's summary shows. */
function findCurrentPoint(
  points: SolarWeatherPoint[],
  now: Date,
): SolarWeatherPoint | null {
  if (points.length === 0) {
    return null;
  }

  return points.reduce((closest, point) =>
    Math.abs(point.time.getTime() - now.getTime()) <
    Math.abs(closest.time.getTime() - now.getTime())
      ? point
      : closest,
  );
}

/**
 * Fetches solar-relevant hourly weather for one location from Open-Meteo
 * and transforms it into `SolarWeather`. Requested with `timezone=UTC`
 * (never Open-Meteo's `timezone=auto`) so every timestamp is an
 * unambiguous instant — formatting into the plant's local time is a UI
 * concern, done at render time with an explicit IANA zone, matching this
 * app's existing convention (e.g. `sofiaDateTimeLabel` in
 * `dashboard/page.tsx`/`market/page.tsx`) rather than trusting a
 * server-local or provider-local wall-clock string.
 *
 * Throws `OpenMeteoApiError` on any failure (network, non-2xx, malformed
 * response) rather than degrading itself — callers decide how to degrade.
 * `dashboard-data.ts` catches this and falls back to `null` so an
 * Open-Meteo outage never breaks the Dashboard.
 */
export async function getSolarWeather(
  latitude: number,
  longitude: number,
): Promise<SolarWeather> {
  const url = new URL(OPEN_METEO_BASE_URL);
  url.searchParams.set("latitude", latitude.toString());
  url.searchParams.set("longitude", longitude.toString());
  url.searchParams.set("hourly", HOURLY_FIELDS.join(","));
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("wind_speed_unit", "ms");
  url.searchParams.set("forecast_days", FORECAST_DAYS.toString());

  const response = await fetch(url.toString(), {
    next: { revalidate: WEATHER_CACHE_REVALIDATE_SECONDS },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new OpenMeteoApiError(
      `Open-Meteo API request failed with status ${response.status}: ${body.slice(0, 500)}`,
    );
  }

  const payload: unknown = await response.json();
  const hourly = (payload as Record<string, unknown> | null)?.hourly;

  if (!isOpenMeteoHourlyResponse(hourly)) {
    throw new OpenMeteoApiError(
      "Open-Meteo response is missing expected hourly fields",
    );
  }

  const length = hourly.time.length;

  if (
    hourly.shortwave_radiation.length !== length ||
    hourly.cloud_cover.length !== length ||
    hourly.temperature_2m.length !== length ||
    hourly.wind_speed_10m.length !== length ||
    hourly.weather_code.length !== length
  ) {
    throw new OpenMeteoApiError(
      "Open-Meteo hourly arrays have inconsistent lengths",
    );
  }

  const points: SolarWeatherPoint[] = hourly.time.map((timeStr, index) => {
    const irradiance = hourly.shortwave_radiation[index];
    const cloudCover = hourly.cloud_cover[index];
    const temperature = hourly.temperature_2m[index];
    const windSpeed = hourly.wind_speed_10m[index];
    const weatherCode = hourly.weather_code[index];

    if (
      irradiance === undefined ||
      cloudCover === undefined ||
      temperature === undefined ||
      windSpeed === undefined ||
      weatherCode === undefined
    ) {
      throw new OpenMeteoApiError(
        `Open-Meteo hourly response is missing a value at index ${index}`,
      );
    }

    return {
      time: new Date(`${timeStr}Z`),
      irradiance,
      cloudCover,
      temperature,
      windSpeed,
      weatherCode,
    };
  });

  const current = findCurrentPoint(points, new Date());

  if (!current) {
    throw new OpenMeteoApiError("Open-Meteo response contained no hourly points");
  }

  return {
    current: {
      irradiance: current.irradiance,
      cloudCover: current.cloudCover,
      temperature: current.temperature,
      windSpeed: current.windSpeed,
      weatherCode: current.weatherCode,
    },
    hourly: points,
  };
}

function parseHourlyPoints(hourly: unknown, sourceLabel: string): SolarWeatherPoint[] {
  if (!isOpenMeteoHourlyResponse(hourly)) {
    throw new OpenMeteoApiError(`${sourceLabel} response is missing expected hourly fields`);
  }

  const length = hourly.time.length;

  if (
    hourly.shortwave_radiation.length !== length ||
    hourly.cloud_cover.length !== length ||
    hourly.temperature_2m.length !== length ||
    hourly.wind_speed_10m.length !== length ||
    hourly.weather_code.length !== length
  ) {
    throw new OpenMeteoApiError(`${sourceLabel} hourly arrays have inconsistent lengths`);
  }

  return hourly.time.map((timeStr, index) => {
    const irradiance = hourly.shortwave_radiation[index];
    const cloudCover = hourly.cloud_cover[index];
    const temperature = hourly.temperature_2m[index];
    const windSpeed = hourly.wind_speed_10m[index];
    const weatherCode = hourly.weather_code[index];

    if (
      irradiance === undefined ||
      cloudCover === undefined ||
      temperature === undefined ||
      windSpeed === undefined ||
      weatherCode === undefined
    ) {
      throw new OpenMeteoApiError(`${sourceLabel} hourly response is missing a value at index ${index}`);
    }

    return {
      time: new Date(`${timeStr}Z`),
      irradiance,
      cloudCover,
      temperature,
      windSpeed,
      weatherCode,
    };
  });
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Historical observed weather for one location over `[startDate, endDate]`
 * (inclusive, UTC calendar days), from Open-Meteo's archive API — the same
 * provider `getSolarWeather` uses, a different endpoint for past dates
 * (Open-Meteo's forecast endpoint only serves the current/next
 * `forecast_days`, never history). Used exclusively by the PV forecast
 * engine (`lib/forecast/*`) for historical calibration, analog-day
 * selection, and walk-forward backtesting — never by any live UI card.
 *
 * Same `OpenMeteoApiError`-throws-on-failure contract as `getSolarWeather`;
 * callers here are backend forecast/backtest code, not a page render, so
 * there is no equivalent "degrade to null" wrapper — a caller that can't
 * tolerate missing historical weather should let this throw.
 */
export async function getHistoricalSolarWeather(
  latitude: number,
  longitude: number,
  startDate: Date,
  endDate: Date,
): Promise<SolarWeatherPoint[]> {
  const url = new URL(OPEN_METEO_ARCHIVE_BASE_URL);
  url.searchParams.set("latitude", latitude.toString());
  url.searchParams.set("longitude", longitude.toString());
  url.searchParams.set("hourly", HOURLY_FIELDS.join(","));
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("wind_speed_unit", "ms");
  url.searchParams.set("start_date", formatDateOnly(startDate));
  url.searchParams.set("end_date", formatDateOnly(endDate));

  const response = await fetch(url.toString(), {
    next: { revalidate: ARCHIVE_CACHE_REVALIDATE_SECONDS },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new OpenMeteoApiError(
      `Open-Meteo archive API request failed with status ${response.status}: ${body.slice(0, 500)}`,
    );
  }

  const payload: unknown = await response.json();
  const hourly = (payload as Record<string, unknown> | null)?.hourly;

  return parseHourlyPoints(hourly, "Open-Meteo archive");
}
