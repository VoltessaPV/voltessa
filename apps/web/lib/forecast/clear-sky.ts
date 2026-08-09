/**
 * PV Generation Forecast — clear-sky irradiance layer.
 *
 * Haurwitz clear-sky GHI model (Haurwitz, B. (1945), "Insolation in
 * Relation to Cloudiness and Cloud Density", Journal of Meteorology, 2(3),
 * 154-166) — a simple, well-established empirical clear-sky model that
 * needs only solar zenith angle as input (no aerosol/turbidity data, which
 * this repository has no source for). This is the same formula pvlib ships
 * as `pvlib.clearsky.haurwitz`; reproduced directly here since pvlib itself
 * (Python) cannot be imported into this Node/TypeScript application.
 */
export function haurwitzClearSkyGhi(zenithDeg: number): number {
  if (zenithDeg >= 90) {
    return 0;
  }

  const cosZenith = Math.cos(zenithDeg * (Math.PI / 180));
  const ghi = 1098 * cosZenith * Math.exp(-0.059 / cosZenith);
  return Math.max(0, ghi);
}
