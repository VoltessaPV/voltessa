/**
 * PV Simulator — XLSX workbook. A real structured workbook (via the shared
 * `writeXlsxWorkbook` / `write-excel-file`), four sheets:
 *
 *  1. Summary          — one glanceable key/value column of the run + its results.
 *  2. Monthly Overview — one row per calendar month + a TOTAL row.
 *  3. Hourly Profile   — one row per hour, aggregated from the 15-minute rows.
 *  4. 15-Minute Detail — one row per original interval + a TOTAL row (frozen header).
 *
 * Every energy cell is a real numeric cell (`#,##0.000`); rates are numeric
 * with a `0.0%` format. A missing value is a genuinely empty cell, never 0.
 */

import { writeXlsxWorkbook, type XlsxCell } from "@/lib/reporting/export-shared";

import { DETAIL_COLUMNS, HOURLY_COLUMNS, MODE_LABEL, MONTHLY_COLUMNS, kwhNumber } from "./format";
import type { SimulationResult } from "./simulate";

const KWH_FMT = "#,##0.000";
const PCT_FMT = "0.0%";
const TOTAL_FILL = "#EEF2F7";

const num = (v: number | null, format = KWH_FMT, bold = false, fill?: string): XlsxCell =>
  v === null
    ? fill
      ? { backgroundColor: fill }
      : null
    : { value: v, type: Number, format, ...(bold ? { fontWeight: "bold" as const } : {}), ...(fill ? { backgroundColor: fill } : {}) };

const str = (v: string, bold = false, fill?: string): XlsxCell => ({
  value: v,
  type: String,
  ...(bold ? { fontWeight: "bold" as const } : {}),
  ...(fill ? { backgroundColor: fill } : {}),
});

export type SimulationXlsxMeta = {
  referencePlantName: string;
  referenceOrganizationName: string;
  referenceCapacityKwp: number;
  periodLabel: string;
  generatedAt: Date;
  loadProfileWarnings: string[];
};

export async function toSimulationXlsxBuffer(
  result: SimulationResult,
  meta: SimulationXlsxMeta,
): Promise<Buffer> {
  const t = result.total;
  const r = result.totalRates;
  const q = result.quality;

  // --- Sheet 1: Summary ---------------------------------------------------
  const summaryRows: Array<[string, XlsxCell]> = [
    ["Simulation period", str(meta.periodLabel)],
    ["Reference PV plant", str(`${meta.referencePlantName} (${meta.referenceOrganizationName})`)],
    ["Reference capacity (kWp)", num(meta.referenceCapacityKwp, "#,##0.##")],
    ["Simulated PV capacity (kWp)", num(result.params.targetCapacityKwp, "#,##0.##")],
    ["Scaling factor (target ÷ reference)", num(result.params.targetCapacityKwp / result.params.referenceCapacityKwp, "#,##0.0000")],
    ["Simulation mode", str(MODE_LABEL[result.mode])],
    ["Timezone", str(result.timeZone)],
    ["Interval", str("15 minutes")],
    ["", str("")],
    ["Total consumption (kWh)", num(t.consumptionKwh)],
    ["Grid import without PV — whole period (kWh)", num(t.gridImportWithoutPvKwh)],
    ["Grid import with PV — whole period (kWh)", num(t.gridImportWithPvKwh)],
    ["Grid import reduction — whole period (kWh)", num(r.gridImportReductionKwh)],
    ["Grid import reduction — whole period (%)", num(r.gridImportReductionRate, PCT_FMT)],
    ["PV generation (kWh)", num(t.pvGenerationKwh)],
    ["Self-consumed PV (kWh)", num(t.pvUsedOnSiteKwh)],
    ["Exported PV (kWh)", num(t.gridExportKwh)],
    ["Curtailed PV (kWh)", num(t.pvCurtailedKwh)],
    ["Solar coverage — whole period (self-consumed PV ÷ consumption)", num(r.solarCoverageRate, PCT_FMT)],
    ["Solar coverage — reference-PV-covered days only", num(r.coveredSolarCoverageRate, PCT_FMT)],
    ["Grid import reduction — covered days only (%)", num(r.coveredGridImportReductionRate, PCT_FMT)],
    ["Self-consumption rate (self-consumed PV ÷ PV generation)", num(r.selfConsumptionRate, PCT_FMT)],
    ["", str("")],
    ["Intervals (15-minute)", num(q.totalIntervals, "#,##0")],
    ["Intervals with missing consumption", num(q.missingLoadIntervals, "#,##0")],
    ["Intervals with no reference PV data", num(q.noReferencePvIntervals, "#,##0")],
    ["Days with no reference PV data", num(q.daysWithoutAnyReferencePv, "#,##0")],
    ["Reference PV coverage (share of days)", num(q.referencePvCoverageRate, PCT_FMT)],
    ["DST-ambiguous intervals (excluded)", num(q.dstAmbiguousIntervals, "#,##0")],
    ["", str("")],
    ["Generated at (UTC)", str(meta.generatedAt.toISOString())],
  ];
  if (meta.loadProfileWarnings.length > 0) {
    summaryRows.push(["", str("")]);
    summaryRows.push(["Load-profile notes", str("")]);
    for (const w of meta.loadProfileWarnings.slice(0, 20)) summaryRows.push(["", str(w)]);
  }
  const summarySheet = {
    sheet: "Summary",
    columns: [{ width: 46 }, { width: 40 }],
    data: summaryRows.map(([label, value]) => [str(label, true), value]),
  };

  // --- Sheet 2: Monthly Overview --------------------------------------------
  const monthlyHeader: XlsxCell[] = MONTHLY_COLUMNS.map((h) => str(h, true));
  const monthlyBody: XlsxCell[][] = result.monthly.map((m) => [
    str(m.month),
    num(m.totals.consumptionKwh),
    num(m.totals.gridImportWithoutPvKwh),
    num(m.totals.gridImportWithPvKwh),
    num(m.totals.pvGenerationKwh),
    num(m.totals.pvUsedOnSiteKwh),
    num(m.totals.pvCurtailedKwh),
    num(m.totals.gridExportKwh),
    num(m.rates.selfConsumptionRate, PCT_FMT),
    num(m.rates.solarCoverageRate, PCT_FMT),
  ]);
  const monthlyTotal: XlsxCell[] = [
    str("TOTAL", true, TOTAL_FILL),
    num(t.consumptionKwh, KWH_FMT, true, TOTAL_FILL),
    num(t.gridImportWithoutPvKwh, KWH_FMT, true, TOTAL_FILL),
    num(t.gridImportWithPvKwh, KWH_FMT, true, TOTAL_FILL),
    num(t.pvGenerationKwh, KWH_FMT, true, TOTAL_FILL),
    num(t.pvUsedOnSiteKwh, KWH_FMT, true, TOTAL_FILL),
    num(t.pvCurtailedKwh, KWH_FMT, true, TOTAL_FILL),
    num(t.gridExportKwh, KWH_FMT, true, TOTAL_FILL),
    num(r.selfConsumptionRate, PCT_FMT, true, TOTAL_FILL),
    num(r.solarCoverageRate, PCT_FMT, true, TOTAL_FILL),
  ];
  const monthlySheet = {
    sheet: "Monthly Overview",
    stickyRowsCount: 1,
    columns: [{ width: 10 }, ...MONTHLY_COLUMNS.slice(1).map(() => ({ width: 26 }))],
    data: [monthlyHeader, ...monthlyBody, monthlyTotal],
  };

  // --- Sheet 3: Hourly Profile ------------------------------------------------
  const hourlySheet = {
    sheet: "Hourly Profile",
    stickyRowsCount: 1,
    columns: [{ width: 16 }, ...HOURLY_COLUMNS.slice(1).map(() => ({ width: 24 }))],
    data: [
      HOURLY_COLUMNS.map((h) => str(h, true)),
      ...result.hourly.map((h) => [
        str(h.hour),
        num(h.consumptionKwh),
        num(h.pvGenerationKwh),
        num(h.pvUsedOnSiteKwh),
        num(h.gridImportWithoutPvKwh),
        num(h.gridImportWithPvKwh),
        num(h.gridExportKwh),
        num(h.pvCurtailedKwh),
      ]),
    ],
  };

  // --- Sheet 4: 15-Minute Detail --------------------------------------------
  const modeLabel = MODE_LABEL[result.mode];
  const capacity = result.params.targetCapacityKwp;
  const detailHeader = DETAIL_COLUMNS.map((c) => str(c.header, true));
  const detailBody: XlsxCell[][] = result.intervals.map((iv) => [
    str(iv.localLabel),
    str(iv.quality),
    num(kwhNumber(iv.loadKwh)),
    num(kwhNumber(iv.referencePvKwh)),
    num(kwhNumber(iv.simulatedPvKwh)),
    num(kwhNumber(iv.pvUsedOnSiteKwh)),
    num(kwhNumber(iv.gridImportWithoutPvKwh)),
    num(kwhNumber(iv.gridImportWithPvKwh)),
    num(kwhNumber(iv.pvSurplusKwh)),
    num(kwhNumber(iv.pvCurtailedKwh)),
    num(kwhNumber(iv.gridExportKwh)),
    str(modeLabel),
    num(capacity, "#,##0.##"),
  ]);
  const detailTotal: XlsxCell[] = [
    str("TOTAL", true, TOTAL_FILL),
    { backgroundColor: TOTAL_FILL },
    num(t.consumptionKwh, KWH_FMT, true, TOTAL_FILL),
    { backgroundColor: TOTAL_FILL },
    num(t.pvGenerationKwh, KWH_FMT, true, TOTAL_FILL),
    num(t.pvUsedOnSiteKwh, KWH_FMT, true, TOTAL_FILL),
    num(t.gridImportWithoutPvKwh, KWH_FMT, true, TOTAL_FILL),
    num(t.gridImportWithPvKwh, KWH_FMT, true, TOTAL_FILL),
    num(t.pvSurplusKwh, KWH_FMT, true, TOTAL_FILL),
    num(t.pvCurtailedKwh, KWH_FMT, true, TOTAL_FILL),
    num(t.gridExportKwh, KWH_FMT, true, TOTAL_FILL),
    { backgroundColor: TOTAL_FILL },
    { backgroundColor: TOTAL_FILL },
  ];
  const detailSheet = {
    sheet: "15-Minute Detail",
    stickyRowsCount: 1,
    columns: [{ width: 18 }, { width: 15 }, ...DETAIL_COLUMNS.slice(2).map(() => ({ width: 22 }))],
    data: [detailHeader, ...detailBody, detailTotal],
  };

  return writeXlsxWorkbook([summarySheet, monthlySheet, hourlySheet, detailSheet]);
}
