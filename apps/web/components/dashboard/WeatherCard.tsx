import type { WeatherData } from "@/app/(platform)/dashboard/dashboard-data";

type WeatherCardProps = {
  weather: WeatherData;
};

const FIELDS = ["Temperature", "Cloud cover", "Wind", "Solar irradiance", "Forecast confidence"] as const;

/**
 * No weather data provider is wired up anywhere in this codebase (no API
 * integration, no credential, no model) — see `dashboard-data.ts`'s
 * `WeatherData` doc comment. Rather than fabricate a number, every field
 * honestly reports unavailable, matching this app's established
 * `available: false` convention (`ProductionReading`,
 * `MarketPriceStatus`, etc.) instead of inventing one.
 */
export function WeatherCard({ weather }: WeatherCardProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)]">
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Weather</p>

      <div className="mt-3 space-y-2">
        {FIELDS.map((field) => (
          <div key={field} className="flex items-center justify-between text-xs">
            <span className="text-slate-500">{field}</span>
            <span className="text-slate-600">
              {weather.available ? "—" : "Not connected"}
            </span>
          </div>
        ))}
      </div>

      {!weather.available && (
        <p className="mt-3 border-t border-white/10 pt-2 text-[11px] leading-snug text-slate-600">
          No weather data source is configured yet.
        </p>
      )}
    </div>
  );
}
