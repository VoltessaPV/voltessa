/**
 * PV Generation Forecast — shared output contract.
 *
 * This is the one shape every consumer (today: `GlidepathCard.tsx`; later:
 * a trading/scheduling layer, per this feature's own requirement) depends
 * on — never on any individual layer's internal representation.
 */
export type PvForecastInterval = {
  timestamp: Date;
  /** Energy over this 15-minute interval, kWh — `forecastKw * 0.25`, never confused with the instantaneous power figure. */
  forecastKwh: number;
  /** Average power over this 15-minute interval, kW. */
  forecastKw: number;
  /** `true` when the pre-clip estimate exceeded `capacityKw` and was physically capped — reported explicitly, never silently absorbed into the error metrics. */
  capacityClipped: boolean;
  components: {
    physicalWeatherKw: number;
    calibrationFactor: number;
    analogKw: number | null;
    analogWeight: number;
    glidePathFactor: number;
  };
};

export type PvForecastResult = {
  modelVersion: string;
  weatherSource: "open-meteo";
  generatedAt: Date;
  plantId: string;
  intervalMinutes: 15;
  intervals: PvForecastInterval[];
  /** Diagnostic metadata surfaced for transparency — not required by consumers, but avoids hiding model assumptions. */
  diagnostics: {
    calibrationSampleCount: number;
    calibrationLookbackDays: number;
    analogDayDates: string[];
    analogWeight: number;
    recentBias: number;
    /** `true` when live weather was unavailable and the physical clear-sky model was used as a neutral fallback input instead — see `pv-forecast-engine.ts`. Never hidden from the output. */
    weatherFallbackUsed: boolean;
  };
};

export const FORECAST_MODEL_VERSION = "pv-forecast-v1";
export const FORECAST_INTERVAL_MINUTES = 15;
