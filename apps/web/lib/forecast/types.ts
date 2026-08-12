import type {
  ForecastConfidence,
  ForecastHorizonTier,
  WeatherRegime,
} from "@/lib/forecast/forecast-tiers";

export type { ForecastConfidence, ForecastHorizonTier, WeatherRegime };

/**
 * Weather-horizon honesty fix (Aug 2026 Chomakovtsi investigation):
 * whether THIS specific interval's physical-model input was real
 * Open-Meteo weather or the clear-sky fallback — determined per interval
 * (`weatherOrClearSkyFallback`'s own `usedFallback` flag), independent of
 * the day-level `horizonTier` label. Exists because a day can be
 * classified `SHORT` by lead-time alone while Open-Meteo's actual
 * `forecast_days` coverage window doesn't reach it (confirmed for
 * Chomakovtsi's 2026-08-13: nominally SHORT, zero real weather points) —
 * this field lets a consumer see the truth regardless of what the tier
 * label claims.
 */
export type WeatherInputSource = "REAL_FORECAST" | "CLEAR_SKY_FALLBACK";

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
    /** See `WeatherInputSource`'s own doc comment. */
    weatherInputSource: WeatherInputSource;
    /** The historical-cloudiness-envelope magnitude actually blended in for this interval's day, when the clear-sky-fallback/no-analog path applied (see `pv-forecast-core.ts`) — `null` whenever that path didn't apply (real weather, or a valid analog was used instead). Surfaced for the same transparency reason `analogKw` already is. */
    historicalEnvelopeKwh: number | null;
    /**
     * D+1 learning-infrastructure milestone (Aug 2026): the exact raw
     * weather inputs and day-level regime label available AT ISSUANCE for
     * this interval — archived (via `forecast-persistence.ts`) so a past
     * vintage's inputs can be reconstructed later without contamination
     * from weather observed after the fact. Diagnostic-only: none of these
     * four fields are read back into `forecastKw`/`forecastKwh` or any
     * other numeric output — see `pv-forecast-core.ts`'s own doc comment
     * at the call site for why this is guaranteed additive.
     */
    ghiWm2: number;
    ambientTempC: number;
    /** `null` only when this interval used the clear-sky fallback (no real weather point available) — never a fabricated reading. */
    cloudCoverPct: number | null;
    weatherRegime: WeatherRegime;
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
    /** Historical analog-day candidates rejected by `analog-days.ts`'s quality filter (insufficient telemetry coverage, zero energy, or an unexplained production collapse) — see that module's own doc comment. Surfaced for transparency, not required by consumers. */
    analogCandidatesRejected: { dateUtc: string; reason: string }[];
  };
};

export const FORECAST_MODEL_VERSION = "pv-forecast-v1";
export const FORECAST_INTERVAL_MINUTES = 15;
