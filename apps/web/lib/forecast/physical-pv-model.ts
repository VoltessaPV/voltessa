import { haurwitzClearSkyGhi } from "@/lib/forecast/clear-sky";
import { solarPositionAt } from "@/lib/forecast/solar-position";

/**
 * PV Generation Forecast — physical PV conversion layer.
 *
 * Converts weather irradiance into expected AC power output using the same
 * simplified physical approach PVWatts (NREL) itself documents as its
 * "simple efficiency model": DC power scales linearly with plane-of-array
 * irradiance relative to the 1000 W/m² STC reference, de-rated by cell
 * temperature (a standard NOCT approximation) and a fixed system-loss
 * factor, then capped at the plant's AC capacity.
 *
 * `Plant` has no stored tilt/azimuth (confirmed against `prisma/schema.prisma`
 * — only `latitude`/`longitude`/`capacityKw` exist). Rather than assume an
 * unmeasured orientation and present it as physical fact, this model uses
 * horizontal GHI directly as the irradiance input (skipping POA
 * transposition), and leans on `calibration.ts`'s plant-specific,
 * time-of-day-bucketed correction — fit against this exact plant's real
 * historical output — to absorb whatever orientation/soiling/wiring bias a
 * full POA transposition would otherwise model explicitly. This is a
 * standard, honest simplification for tilt-agnostic PV nowcasting when
 * as-built array orientation isn't digitized anywhere in the system.
 */

/** PVWatts' own default total system-loss factor (soiling, mismatch, wiring, connections, availability — excluding the temperature effect, modeled separately below). */
const SYSTEM_LOSS_FACTOR = 0.86;
/** Typical crystalline-silicon module NOCT, °C — used only to estimate cell temperature from ambient + irradiance. */
const NOCT_C = 45;
/** PVWatts' own default module power temperature coefficient, per °C above 25°C (STC). */
const TEMP_COEFF_PER_C = -0.0047;
/** STC reference irradiance, W/m² — `capacityKw` is a nameplate rating measured at this irradiance, so power scales as `ghiWm2 / 1000`, never as a ratio to clear-sky irradiance (see `estimatePhysicalPvKw`'s doc comment for why that distinction matters). */
const STC_REFERENCE_IRRADIANCE_WM2 = 1000;
/** Irradiance above STC reference is physically possible (cloud-edge brightening, low sun-angle grazing on some sensors) but bounded here to avoid a single noisy weather sample producing an unphysical spike. */
const MAX_IRRADIANCE_RATIO = 1.2;
/** Clear-sky index above 1 is physically possible but bounded for the same reason — used only for the diagnostic/analog-day cloud-fraction figure, never for scaling power (see below). */
const MAX_CLEAR_SKY_INDEX = 1.2;

export type PhysicalModelInput = {
  timestamp: Date;
  latitude: number;
  longitude: number;
  /** Global horizontal irradiance, W/m² — real observed or forecast, from `lib/weather/openMeteo.ts`. */
  ghiWm2: number;
  /** Ambient air temperature, °C. */
  ambientTempC: number;
  capacityKw: number;
};

export type PhysicalModelOutput = {
  elevationDeg: number;
  clearSkyGhiWm2: number;
  /** `ghiWm2 / clearSkyGhiWm2`, clipped to `[0, MAX_CLEAR_SKY_INDEX]` — 0 at night (both sides are 0) or when the sky is fully overcast. */
  clearSkyIndex: number;
  /** Physical-model AC power estimate, kW, before plant-specific historical calibration — already capped at `capacityKw` and floored at 0. */
  forecastKw: number;
};

/**
 * One instant's physical PV estimate. Zero whenever the sun is below the
 * horizon (`elevationDeg <= 0`) — satisfied structurally here, not by a
 * separate day/night branch, since `clearSkyGhi` is already 0 at
 * `zenithDeg >= 90` and every downstream factor is a multiplier of it.
 */
export function estimatePhysicalPvKw(input: PhysicalModelInput): PhysicalModelOutput {
  const { timestamp, latitude, longitude, ghiWm2, ambientTempC, capacityKw } = input;

  const { elevationDeg, zenithDeg } = solarPositionAt(timestamp, latitude, longitude);
  const clearSkyGhiWm2 = haurwitzClearSkyGhi(zenithDeg);

  if (elevationDeg <= 0 || clearSkyGhiWm2 <= 0) {
    return { elevationDeg, clearSkyGhiWm2, clearSkyIndex: 0, forecastKw: 0 };
  }

  // Diagnostic/analog-day cloud-fraction figure only — NOT used to scale
  // power. `clearSkyIndex` (actual GHI relative to what a cloudless sky
  // would give at this exact solar position) stays close to 1 all day on a
  // clear day regardless of solar elevation, since both sides of the ratio
  // fall together at low sun angles — using it as the power-scaling factor
  // was this model's original bug (see git history): it produced a flat,
  // capacity-sized output all day whenever cloudless, instead of following
  // the real elevation-driven irradiance curve (low at sunrise/sunset, peak
  // at solar noon).
  const clearSkyIndex = Math.min(MAX_CLEAR_SKY_INDEX, Math.max(0, ghiWm2) / clearSkyGhiWm2);

  // Power scales with the actual irradiance magnitude relative to the
  // 1000 W/m² STC reference `capacityKw` is rated at — this is what
  // naturally reproduces the diurnal shape (irradiance itself is low at
  // sunrise/sunset, high at solar noon), which `clearSkyIndex` alone does
  // not.
  const irradianceRatio = Math.min(MAX_IRRADIANCE_RATIO, Math.max(0, ghiWm2) / STC_REFERENCE_IRRADIANCE_WM2);

  const cellTempC = ambientTempC + (ghiWm2 / 800) * (NOCT_C - 20);
  const tempFactor = 1 + TEMP_COEFF_PER_C * (cellTempC - 25);

  const dcKw = capacityKw * irradianceRatio * tempFactor * SYSTEM_LOSS_FACTOR;
  const forecastKw = Math.min(capacityKw, Math.max(0, dcKw));

  return { elevationDeg, clearSkyGhiWm2, clearSkyIndex, forecastKw };
}
