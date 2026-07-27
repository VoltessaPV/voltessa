import { CloudSun } from "lucide-react";

import type { SolarWeather } from "@/lib/weather/openMeteo";

/** Shown below the summary — enough to read as a strip without crowding this card's narrow (1-of-4 grid column) width. */
const HOURLY_STRIP_COUNT = 8;
/** Matches every other Dashboard/Market timestamp's hardcoded zone — see `dashboard-data.ts`'s `BULGARIA_TIMEZONE` doc comment for why this isn't read from `Plant.timezone`. */
const BULGARIA_TIMEZONE = "Europe/Sofia";

type WeatherCardProps = {
  weather: SolarWeather | null;
};

/**
 * Cloud cover, not Open-Meteo's own weather codes, drives the icon — for
 * photovoltaic production, "how much sky is obscured" is the meaningful
 * signal, not "is it raining" (per this widget's own design brief).
 */
function solarCondition(cloudCoverPercent: number): { icon: string; label: string } {
  if (cloudCoverPercent <= 15) {
    return { icon: "☀", label: "Clear" };
  }
  if (cloudCoverPercent <= 40) {
    return { icon: "🌤", label: "Mostly sunny" };
  }
  if (cloudCoverPercent <= 70) {
    return { icon: "⛅", label: "Partly cloudy" };
  }
  if (cloudCoverPercent <= 90) {
    return { icon: "☁", label: "Cloudy" };
  }
  return { icon: "☁☁", label: "Overcast" };
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

  const condition = solarCondition(weather.current.cloudCover);
  const now = Date.now();
  const upcoming = weather.hourly
    .filter((point) => point.time.getTime() >= now)
    .slice(0, HOURLY_STRIP_COUNT);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)]">
      <CardEyebrow />

      <div className="mt-3 flex items-center gap-2 text-sm font-medium text-white">
        <span aria-hidden>{condition.icon}</span>
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
            const pointCondition = solarCondition(point.cloudCover);

            return (
              <div
                key={point.time.getTime()}
                className="flex shrink-0 flex-col items-center gap-1"
              >
                <span className="text-[10px] text-slate-500">
                  {hourLabel(point.time)}
                </span>
                <span aria-hidden className="text-sm">
                  {pointCondition.icon}
                </span>
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
