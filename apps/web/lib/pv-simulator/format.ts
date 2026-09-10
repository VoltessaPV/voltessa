/**
 * PV Simulator — shared, locale-independent labels and formatting for the
 * CSV / XLSX exporters and the UI preview, so nothing drifts between them.
 */

import { slugifySegment } from "@/lib/reporting/export-shared";

import type { SimulationMode } from "./simulate";

export const MODE_LABEL: Record<SimulationMode, string> = {
  self_consumption_only: "Self-consumption only (export disabled)",
  self_consumption_plus_export: "Self-consumption + export",
};

/** The 15-minute detail columns, in fixed order. `key` maps to an `IntervalResult` field (or a synthetic). */
export const DETAIL_COLUMNS = [
  { key: "timestamp", header: "Timestamp" },
  { key: "quality", header: "Data quality" },
  { key: "loadKwh", header: "Customer consumption (kWh)" },
  { key: "referencePvKwh", header: "Reference PV production (kWh)" },
  { key: "simulatedPvKwh", header: "Simulated PV production (kWh)" },
  { key: "pvUsedOnSiteKwh", header: "PV used on-site (kWh)" },
  { key: "gridImportWithoutPvKwh", header: "Grid import without PV (kWh)" },
  { key: "gridImportWithPvKwh", header: "Grid import with PV (kWh)" },
  { key: "pvSurplusKwh", header: "PV surplus (kWh)" },
  { key: "pvCurtailedKwh", header: "PV curtailed (kWh)" },
  { key: "gridExportKwh", header: "Grid export (kWh)" },
  { key: "mode", header: "Simulation mode" },
  { key: "pvCapacityKwp", header: "PV capacity (kWp)" },
] as const;

export const MONTHLY_COLUMNS = [
  "Month",
  "Total consumption without PV (kWh)",
  "Grid import without PV (kWh)",
  "Grid import with PV (kWh)",
  "PV generation (kWh)",
  "PV used on-site (kWh)",
  "PV curtailed (kWh)",
  "Grid export (kWh)",
  "Self-consumption rate",
  "Solar coverage",
] as const;

export const HOURLY_COLUMNS = [
  "Hour",
  "Consumption (kWh)",
  "PV generation (kWh)",
  "PV used on-site (kWh)",
  "Grid import without PV (kWh)",
  "Grid import with PV (kWh)",
  "Grid export (kWh)",
  "PV curtailed (kWh)",
] as const;

/** Fixed-decimal kWh string (`.` separator, no locale). `null` → `""` (never `"0"`). */
export function kwh(value: number | null | undefined, dp = 3): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return value.toFixed(dp);
}

/** Rate (0..1) as a percentage string, e.g. `72.4%`. `null` → `""`. */
export function pct(rate: number | null | undefined, dp = 1): string {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return "";
  return `${(rate * 100).toFixed(dp)}%`;
}

/** kWh as a real rounded number for an XLSX numeric cell, or null for a blank cell. */
export function kwhNumber(value: number | null | undefined, dp = 3): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const f = 10 ** dp;
  return Math.round((value + Number.EPSILON) * f) / f;
}

export function simulationFilename(
  referencePlantName: string,
  capacityKwp: number,
  mode: SimulationMode,
  periodStartDate: string,
  periodEndDate: string,
  ext: "csv" | "xlsx",
): string {
  const modeSlug = mode === "self_consumption_plus_export" ? "export" : "selfcons";
  const capacity = Number.isInteger(capacityKwp) ? String(capacityKwp) : capacityKwp.toFixed(1);
  return `voltessa-pv-sim-${slugifySegment(referencePlantName, "plant")}-${capacity}kwp-${modeSlug}-${periodStartDate}-${periodEndDate}.${ext}`;
}
