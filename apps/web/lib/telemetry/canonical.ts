import {
  getPlantDailyKpiRange,
} from "@/lib/telemetry/plant-daily-kpi";
import {
  getLatestInverterTelemetryForDevices,
  getLatestMeterTelemetry,
  type LatestInverterRow,
  type LatestMeterRow,
} from "@/lib/telemetry/queries";

/**
 * Canonical Telemetry Architecture milestone. Voltessa's single access
 * layer for plant-level production/export/import quantities — Dashboard,
 * Market, and any future Automation/Forecasting/Reporting feature read
 * these quantities through this module, never by importing
 * `PlantDailyKpi`/`DeviceTelemetry` fields directly.
 *
 * This module performs no new calculation and changes no behavior: every
 * function here is a pure, renamed wrapper around the existing
 * Huawei-ingestion-adjacent access functions (`plant-daily-kpi.ts`,
 * `queries.ts`), which remain responsible for mapping Huawei's own field
 * names (`day_power`, `total_power`, `meterActivePower`, ...) into these
 * canonical quantities. A future second vendor's importer maps into the
 * exact same underlying tables/columns those modules already read — this
 * layer, and everything built on it, never needs to change.
 */

export type CanonicalReading =
  | { available: true; kw: number }
  | { available: false; reason: string };

const UNAVAILABLE_NO_TELEMETRY: CanonicalReading = {
  available: false,
  reason: "no_telemetry",
};

/**
 * Canonical current production (kW) — real-time, summed across every
 * inverter's newest sample. Backed by `DeviceTelemetry.activePower`
 * (already a vendor-neutral typed column); this function only performs
 * the cross-device summation, moved here out of a page-scoped module
 * (`market/production-data.ts`) so every consumer shares one
 * implementation instead of each reimplementing it. Identical to the
 * former `sumInverterProduction`.
 */
export function getCurrentProduction(rows: LatestInverterRow[]): CanonicalReading {
  const readings = rows
    .map((row) => (row.activePower !== null ? row.activePower.toNumber() : null))
    .filter((kw): kw is number => kw !== null);

  if (readings.length === 0) {
    return UNAVAILABLE_NO_TELEMETRY;
  }

  const totalKw = Math.round(readings.reduce((sum, kw) => sum + kw, 0) * 100) / 100;

  return { available: true, kw: totalKw };
}

/**
 * Canonical current export/import (kW) — the meter's signed real-time
 * reading, split by sign (identical to the former `deriveGridReadings`).
 *
 * Producer business rule (Canonical Telemetry Architecture milestone):
 * for a plant with no real meter reading, `currentExport` falls back to
 * the plant's own canonical current production — a Producer, by
 * definition, exports everything it produces. `currentImport` has no
 * equivalent fallback: a Producer never imports, and there is no real
 * reading to substitute either way, so it stays exactly as unavailable
 * as the meter reading itself. A plant with a real meter (Atlanta) always
 * resolves both from the real reading and never reaches this fallback.
 */
export function getCurrentGridReadings(
  row: LatestMeterRow | null,
  currentProduction: CanonicalReading,
): { currentExport: CanonicalReading; currentImport: CanonicalReading } {
  if (!row || row.meterActivePower === null) {
    return { currentExport: currentProduction, currentImport: UNAVAILABLE_NO_TELEMETRY };
  }

  const kw = row.meterActivePower.toNumber();

  return {
    currentExport: kw > 0 ? { available: true, kw } : { available: true, kw: 0 },
    currentImport: kw < 0 ? { available: true, kw: Math.abs(kw) } : { available: true, kw: 0 },
  };
}

/**
 * One day's canonical daily production/consumption/lifetime-production —
 * the manufacturer-reported daily counter (`day_power`/`PVYield`) and
 * lifetime counter (`total_power`), never reconstructed from raw
 * telemetry. Identical fields to the former `PlantDailyKpiRangeDay`,
 * renamed to the canonical vocabulary.
 */
export type CanonicalDailyRecord = {
  localDate: Date;
  dailyProduction: number;
  dailyConsumption: number;
  lifetimeProduction: number | null;
};

export type CanonicalDailyTotals =
  | { available: false }
  | {
      available: true;
      dailyProduction: number;
      dailyConsumption: number;
      days: CanonicalDailyRecord[];
    };

/**
 * Canonical daily production/consumption for `[start, end)`, plus each
 * day's lifetime production — backed by `PlantDailyKpi`, the table the
 * Huawei daily-KPI importer writes Huawei's own reported totals into.
 * Identical to the former `getPlantDailyKpiRange`, renamed to the
 * canonical vocabulary. Voltessa never recomputes an alternative total
 * from raw telemetry when the manufacturer already reports one.
 */
export async function getDailyTotals(
  plantId: string,
  start: Date,
  end: Date,
): Promise<CanonicalDailyTotals> {
  const result = await getPlantDailyKpiRange(plantId, start, end);

  if (!result.available) {
    return { available: false };
  }

  return {
    available: true,
    dailyProduction: result.producedKwh,
    dailyConsumption: result.consumedKwh,
    days: result.days.map((day) => ({
      localDate: day.localDate,
      dailyProduction: day.producedKwh,
      dailyConsumption: day.consumedKwh,
      lifetimeProduction: day.totalYieldKwh,
    })),
  };
}

/**
 * Lifetime production as of the most recent day in an already-fetched
 * `CanonicalDailyTotals` — that day's own reported lifetime counter,
 * never summed or recomputed across days.
 */
export function latestLifetimeProduction(totals: CanonicalDailyTotals): number | null {
  if (!totals.available) {
    return null;
  }

  return totals.days.at(-1)?.lifetimeProduction ?? null;
}

// Re-exported so Dashboard/Market never need to import device-telemetry
// query helpers directly for these two specific reads — same underlying
// functions, same behavior, one import source.
export { getLatestInverterTelemetryForDevices, getLatestMeterTelemetry };
export type { LatestInverterRow, LatestMeterRow };
