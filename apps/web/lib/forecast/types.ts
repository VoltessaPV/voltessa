import type { ForecastConfidence, ForecastHorizonTier } from "@/lib/forecast/forecast-tiers";

export type { ForecastConfidence, ForecastHorizonTier };

/**
 * PV Generation Forecast — shared output contract.
 *
 * This is the one shape every consumer (today: the Dashboard's Live Energy
 * card; later: a trading/scheduling layer, per this feature's own
 * requirement) depends on — never on any individual layer's internal
 * representation.
 */
export type PvForecastInterval = {
  timestamp: Date;
  /** Energy over this 15-minute interval, kWh — `forecastKw * 0.25`, never confused with the instantaneous power figure. */
  forecastKwh: number;
  /** Average power over this 15-minute interval, kW. */
  forecastKw: number;
  /** `true` when the pre-clip estimate exceeded `capacityKw` and was physically capped — reported explicitly, never silently absorbed into the error metrics. */
  capacityClipped: boolean;
  /** Which layer of the forecast hierarchy produced this interval — see `lib/forecast/forecast-tiers.ts`. */
  horizonTier: ForecastHorizonTier;
  /** Simple, non-statistical confidence label — never a fabricated precise percentage. */
  confidence: ForecastConfidence;
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
  /**
   * Today's elapsed Available PV, aggregated to the same 15-minute grid as
   * `intervals` — reconstructed via `reconstructAvailablePv` (Zero-Export-
   * independent, never raw curtailed export), the exact same source
   * `intervals` itself is calibrated against. Empty before any of today has
   * elapsed. Exposed so a UI can render "actual so far, forecast for the
   * rest" on one continuous timeline without a second, duplicate query —
   * this is the same data the engine's own glide-path correction already
   * computed internally, just surfaced rather than discarded.
   */
  observedToday: { timestamp: Date; actualKwh: number; actualKw: number }[];
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
