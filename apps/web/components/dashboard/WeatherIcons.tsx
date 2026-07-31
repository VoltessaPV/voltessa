import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  CloudSunRain,
  Cloudy,
  Sun,
  type LucideIcon,
} from "lucide-react";

/**
 * The single weather-condition icon set for the whole app — the Dashboard's
 * WeatherCard and the landing page (`PlatformPreview.tsx`) render the exact
 * same `WeatherCard` component, so this file is the one place that owns
 * "which icon, which color" per condition. Built on `lucide-react` (already
 * a dependency, already used for every other icon in the app) rather than
 * hand-drawn SVGs, so these stay visually consistent with the rest of the
 * UI's line-icon style instead of introducing a second icon language.
 */
export type WeatherConditionKey =
  | "clear"
  | "mostlyClear"
  | "partlyCloudy"
  | "cloudy"
  | "overcast"
  | "rain"
  | "showers"
  | "thunderstorm"
  | "snow"
  | "fog";

/**
 * One muted, natural tone per condition (yellow sun, light gray cloud, blue
 * rain, near-white snow, ...) — deliberately single-hue per icon rather than
 * multi-color, so the widget stays minimalist instead of looking busy.
 */
const WEATHER_CONDITION_COLORS: Record<WeatherConditionKey, string> = {
  clear: "#fbbf24",
  mostlyClear: "#fcd34d",
  partlyCloudy: "#cbd5e1",
  cloudy: "#cbd5e1",
  overcast: "#94a3b8",
  rain: "#60a5fa",
  showers: "#7dd3fc",
  thunderstorm: "#a78bfa",
  snow: "#e2e8f0",
  fog: "#94a3b8",
};

const WEATHER_CONDITION_ICONS: Record<
  Exclude<WeatherConditionKey, "overcast">,
  LucideIcon
> = {
  clear: Sun,
  mostlyClear: CloudSun,
  partlyCloudy: Cloudy,
  cloudy: Cloud,
  rain: CloudRain,
  showers: CloudSunRain,
  thunderstorm: CloudLightning,
  snow: CloudSnow,
  fog: CloudFog,
};

type WeatherIconProps = {
  condition: WeatherConditionKey;
  /** Defaults to 20px, this widget's main-icon size; pass 16-18 for the hourly forecast strip. */
  size?: number;
  className?: string;
};

/**
 * "Overcast" has no direct lucide equivalent (a cloud bank denser than a
 * single `Cloud`) — composed from two layered `Cloud` icons instead of a
 * hand-drawn shape, so it stays visually consistent with every other icon
 * in this set rather than introducing a one-off custom glyph.
 */
function OvercastIcon({ size, className }: { size: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={className}
      style={{ position: "relative", display: "inline-block", width: size, height: size }}
    >
      <Cloud
        width={size * 0.72}
        height={size * 0.72}
        color={WEATHER_CONDITION_COLORS.overcast}
        strokeWidth={1.75}
        style={{ position: "absolute", left: 0, top: 0, opacity: 0.7 }}
      />
      <Cloud
        width={size * 0.85}
        height={size * 0.85}
        color={WEATHER_CONDITION_COLORS.overcast}
        strokeWidth={1.75}
        style={{ position: "absolute", right: 0, bottom: 0 }}
      />
    </span>
  );
}

export function WeatherIcon({ condition, size = 20, className }: WeatherIconProps) {
  if (condition === "overcast") {
    return <OvercastIcon size={size} className={className} />;
  }

  const Icon = WEATHER_CONDITION_ICONS[condition];

  return (
    <Icon
      aria-hidden
      width={size}
      height={size}
      color={WEATHER_CONDITION_COLORS[condition]}
      strokeWidth={1.75}
      className={className}
    />
  );
}
