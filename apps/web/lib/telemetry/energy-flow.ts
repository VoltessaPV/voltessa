/**
 * The one documented domain calculation behind the Dashboard's System
 * Overview and Live Energy chart (Design-System Consistency milestone).
 * Pure function, no I/O — the UI only renders whatever this returns, never
 * modifies, clamps, or floors a measured value itself.
 *
 * There is no independent "Home"/consumption meter anywhere in this
 * FusionSolar integration — consumption has always been a derived
 * quantity, via the same identity `energy-metrics.ts` already uses for the
 * Produced/Consumed/Exported/Imported KPIs: `consumption = production +
 * import - export`. This module applies that identity to the real-time
 * reading (and, per timestamp, the historical series).
 *
 * Exactly two valid states, determined solely by the real meter reading
 * (`exportKw`/`importKw` — one is always exactly `0`, see
 * `get-plant-power-status.ts`), never inferred from configuration and
 * never both shown at once:
 *
 * - `exporting`: grid export > 0 (covers `PV >= consumption`, including
 *   the exact-zero-net tie — matches Case A's own "`>=`" definition).
 * - `importing`: grid import > 0.
 *
 * `pvKw` and `gridKw` are always the real measured values, unmodified —
 * never fabricated, clamped, or floored. If the derived consumption would
 * be physically impossible (negative — i.e. the real-time PV reading is
 * less than the meter's real-time export reading, a genuine disagreement
 * between two independently-read devices), this module does **not**
 * invent a value to hide it: it reports `consistent: false` so the UI can
 * render an honest "measurements are currently inconsistent" state instead
 * of a wrong number.
 *
 * This inconsistency path exists as a general safety net for real-time
 * measurement disagreement between independently-polled devices — it is
 * not a workaround for a specific known bug. The specific, confirmed root
 * cause that used to make this path fire on almost every reading (an
 * inverter `active_power` unit-conversion bug — inverters report already
 * in kW, not watts like the meter) has been fixed upstream, in
 * `get-plant-power-status.ts` / `get-plant-inverter-status.ts` /
 * `import-device-telemetry.ts`, with a one-time backfill of every
 * already-stored inverter `DeviceTelemetry.activePower` row. See
 * `docs/research/fusionsolar-active-power-control.md` §13 for the full
 * investigation. Do not "fix" a future inconsistency reading in this
 * module or in the UI — if `consistent: false` starts appearing again,
 * that means a new, real measurement problem exists and needs the same
 * kind of root-cause investigation, not a clamp.
 */

export type EnergyFlowResult =
  | { available: false }
  | {
      available: true;
      pvKw: number;
      gridKw: number;
      direction: "importing" | "exporting";
      consumption: { consistent: true; kw: number } | { consistent: false };
    };

export function deriveEnergyFlow(pvKw: number, exportKw: number, importKw: number): EnergyFlowResult {
  if (importKw > 0) {
    // Home = PV + Import — a sum of two non-negative real readings can
    // never be physically impossible, so this branch is always consistent.
    return {
      available: true,
      pvKw,
      gridKw: importKw,
      direction: "importing",
      consumption: { consistent: true, kw: Math.round((pvKw + importKw) * 100) / 100 },
    };
  }

  const consumptionKw = Math.round((pvKw - exportKw) * 100) / 100;

  return {
    available: true,
    pvKw,
    gridKw: exportKw,
    direction: "exporting",
    consumption:
      consumptionKw >= 0 ? { consistent: true, kw: consumptionKw } : { consistent: false },
  };
}
