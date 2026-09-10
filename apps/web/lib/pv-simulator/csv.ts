/**
 * PV Simulator — 15-minute detail CSV. Reuses the shared export primitives
 * (`csvDocument` — UTF-8 BOM, CRLF, RFC 4180 quoting). One row per original
 * 15-minute interval, in exact input order, then a `TOTAL` row that sums
 * the energy columns (mode/capacity/quality left blank). A missing value is
 * an empty field, never `0`.
 */

import { csvDocument } from "@/lib/reporting/export-shared";

import { DETAIL_COLUMNS, MODE_LABEL, kwh } from "./format";
import type { SimulationResult } from "./simulate";

export function toDetailCsv(result: SimulationResult): string {
  const capacity = String(result.params.targetCapacityKwp);
  const modeLabel = MODE_LABEL[result.mode];

  const rows: string[][] = [DETAIL_COLUMNS.map((c) => c.header)];

  for (const iv of result.intervals) {
    rows.push([
      iv.localLabel,
      iv.quality,
      kwh(iv.loadKwh),
      kwh(iv.referencePvKwh),
      kwh(iv.simulatedPvKwh),
      kwh(iv.pvUsedOnSiteKwh),
      kwh(iv.gridImportWithoutPvKwh),
      kwh(iv.gridImportWithPvKwh),
      kwh(iv.pvSurplusKwh),
      kwh(iv.pvCurtailedKwh),
      kwh(iv.gridExportKwh),
      modeLabel,
      capacity,
    ]);
  }

  const t = result.total;
  rows.push([
    "TOTAL",
    "",
    kwh(t.consumptionKwh),
    "",
    kwh(t.pvGenerationKwh),
    kwh(t.pvUsedOnSiteKwh),
    kwh(t.gridImportWithoutPvKwh),
    kwh(t.gridImportWithPvKwh),
    kwh(t.pvSurplusKwh),
    kwh(t.pvCurtailedKwh),
    kwh(t.gridExportKwh),
    "",
    "",
  ]);

  return csvDocument(rows);
}
