import { CloudSun } from "lucide-react";

import type { SolarWeather } from "@/lib/weather/openMeteo";

import { WEATHER_CONDITION_LABELS, WeatherIcon, type WeatherConditionKey } from "./WeatherIcons";

/** Shown below the summary — enough to read as a strip without crowding this card's narrow (1-of-4 grid column) width. */
const HOURLY_STRIP_COUNT = 8;
/** Matches every other Dashboard/Market timestamp's hardcoded zone — see `dashboard-data.ts`'s `BULGARIA_TIMEZONE` doc comment for why this isn't read from `Plant.timezone`. */
const BULGARIA_TIMEZONE = "Europe/Sofia";

type WeatherCardProps = {
  weather: SolarWeather | null;
};

/** Open-Meteo WMO weather codes, grouped by which icon they should force. */
const SEVERE_WEATHER_CODES = new Set([95, 96, 99]);
const SNOW_WEATHER_CODES = new Set([71, 73, 75, 77, 85, 86]);
const SHOWER_WEATHER_CODES = new Set([80, 81, 82]);
const RAIN_WEATHER_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67]);
const FOG_WEATHER_CODES = new Set([45, 48]);

/**
 * `weatherCode` only overrides the icon when an actual weather event is
 * happening (storm/snow/rain/fog) - `null` means "nothing more informative
 * than cloud cover," so the caller falls through to `cloudCoverCondition`.
 * Priority: severe weather > snow > rain/showers > fog, per the codes'
 * relative rarity/urgency, not per Open-Meteo's own code ordering.
 */
function weatherCodeOverride(weatherCode: number): WeatherConditionKey | null {
  if (SEVERE_WEATHER_CODES.has(weatherCode)) {
    return "thunderstorm";
  }
  if (SNOW_WEATHER_CODES.has(weatherCode)) {
    return "snow";
  }
  if (SHOWER_WEATHER_CODES.has(weatherCode)) {
    return "showers";
  }
  if (RAIN_WEATHER_CODES.has(weatherCode)) {
    return "rain";
  }
  if (FOG_WEATHER_CODES.has(weatherCode)) {
    return "fog";
  }
  return null;
}

/**
 * Cloud cover is the primary PV-relevant signal - for photovoltaic
 * production, "how much sky is obscured" is the meaningful default, not
 * "is it raining" (per this widget's own design brief).
 */
function cloudCoverCondition(cloudCoverPercent: number): WeatherConditionKey {
  if (cloudCoverPercent <= 15) {
    return "clear";
  }
  if (cloudCoverPercent <= 40) {
    return "mostlyClear";
  }
  if (cloudCoverPercent <= 70) {
    return "partlyCloudy";
  }
  if (cloudCoverPercent <= 90) {
    return "cloudy";
  }
  return "overcast";
}

/**
 * Cloud cover drives the icon by default; `weatherCode` overrides it only
 * when a real weather event (storm/snow/rain/fog) is more informative than
 * cloud cover alone - see `weatherCodeOverride`.
 */
function solarCondition(
  cloudCoverPercent: number,
  weatherCode: number,
): { condition: WeatherConditionKey; label: string } {
  const condition = weatherCodeOverride(weatherCode) ?? cloudCoverCondition(cloudCoverPercent);
  return { condition, label: WEATHER_CONDITION_LABELS[condition] };
}

function hourLabel(date: Date): string {
  return date.toLocaleTimeString("en-GB", {
    timeZone: BULGARIA_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CardEyebrow() {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-500">
        <CloudSun className="h-3.5 w-3.5" />
        Solar Weather
      </p>
      <p className="mt-0.5 text-[11px] text-slate-600">
        Solar forecast for the active plant
      </p>
    </div>
  );
}

/**
 * Solar-forecast widget for the active plant's own coordinates (see
 * `dashboard-data.ts`'s `fetchSolarWeatherSafe`) — never a generic weather
 * forecast. Sourced entirely from `SolarWeather`
 * (`lib/weather/openMeteo.ts`'s internal model); this component never sees
 * Open-Meteo's raw response shape, so swapping providers later touches only
 * that module.
 */
export function WeatherCard({ weather }: WeatherCardProps) {
  if (!weather) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)]">
        <CardEyebrow />
        <p className="mt-3 text-sm text-slate-500">
          Solar weather temporarily unavailable.
        </p>
      </div>
    );
  }

  const condition = solarCondition(weather.current.cloudCover, weather.current.weatherCode);
  const now = Date.now();
  const upcoming = weather.hourly
    .filter((point) => point.time.getTime() >= now)
    .slice(0, HOURLY_STRIP_COUNT);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)]">
      <CardEyebrow />

      <div className="mt-3 flex items-center gap-2 text-sm font-medium text-white">
        <WeatherIcon condition={condition.condition} size={20} />
        {condition.label}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        <div>
          <dt className="text-[11px] text-slate-500">Solar irradiance</dt>
          <dd className="text-sm font-medium tabular-nums text-white">
            {Math.round(weather.current.irradiance)} W/m²
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-slate-500">Cloud cover</dt>
          <dd className="text-sm font-medium tabular-nums text-white">
            {Math.round(weather.current.cloudCover)}%
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-slate-500">Temperature</dt>
          <dd className="text-sm font-medium tabular-nums text-white">
            {Math.round(weather.current.temperature)}°C
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-slate-500">Wind</dt>
          <dd className="text-sm font-medium tabular-nums text-white">
            {weather.current.windSpeed.toFixed(1)} m/s
          </dd>
        </div>
      </dl>

      {upcoming.length > 0 && (
        <div className="mt-3 flex gap-3 overflow-x-auto border-t border-white/10 pt-3">
          {upcoming.map((point) => {
            const pointCondition = solarCondition(point.cloudCover, point.weatherCode);

            return (
              <div
                key={point.time.getTime()}
                className="flex shrink-0 flex-col items-center gap-1"
              >
                <span className="text-[10px] text-slate-500">
                  {hourLabel(point.time)}
                </span>
                <WeatherIcon condition={pointCondition.condition} size={17} />
                <span className="text-[10px] tabular-nums text-slate-400">
                  {Math.round(point.irradiance)} W/m²
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
