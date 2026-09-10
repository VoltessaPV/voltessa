"use server";

import { readSheet } from "read-excel-file/node";

import { requirePlatformAdmin } from "@/lib/auth/session";
import { zonedTimeToUtc } from "@/lib/market-price/timezone";
import { formatWallClockTimestamp } from "@/lib/reporting/export-shared";
import { toDetailCsv } from "@/lib/pv-simulator/csv";
import {
  DETAIL_COLUMNS,
  MODE_LABEL,
  kwh,
  pct,
  simulationFilename,
} from "@/lib/pv-simulator/format";
import { generateSimulation } from "@/lib/pv-simulator/generate-simulation";
import {
  parseLoadProfile,
  type LoadProfileUnitMode,
  type SheetRows,
} from "@/lib/pv-simulator/load-profile";
import { getReferencePlant } from "@/lib/pv-simulator/reference-plant";
import { SimulationValidationError, type SimulationMode } from "@/lib/pv-simulator/simulate";
import { toSimulationXlsxBuffer } from "@/lib/pv-simulator/xlsx";

/**
 * Admin PV Simulator — the two Server Actions the page uses. Both
 * independently call `requirePlatformAdmin()` (a layout render never
 * protects a Server Action's own RPC — see `lib/auth/session.ts`) and
 * re-resolve the reference plant from the database by id, so its timezone /
 * organization / capacity are never trusted from the browser. Non-admin
 * callers hit the app's standard `forbidden()` (403); unauthenticated
 * callers are redirected to `/login`.
 *
 * The uploaded Excel file is parsed in memory and never persisted.
 */

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_INTERVALS = 150_000; // ~4.3 years of 15-minute data — a sane upper bound.
const PREVIEW_DETAIL_ROWS = 300;

type ExportFormat = "csv" | "xlsx";

const MIME: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export type MonthlyRow = {
  month: string;
  consumptionKwh: string;
  gridImportWithoutPvKwh: string;
  gridImportWithPvKwh: string;
  pvGenerationKwh: string;
  pvUsedOnSiteKwh: string;
  pvCurtailedKwh: string;
  gridExportKwh: string;
  selfConsumptionRate: string;
  solarCoverageRate: string;
};

export type SimulationPreview = {
  referencePlantName: string;
  referenceOrganizationName: string;
  referenceCapacityKwp: number;
  targetCapacityKwp: number;
  mode: SimulationMode;
  modeLabel: string;
  timeZone: string;
  periodLabel: string;
  summary: {
    totalConsumptionKwh: string;
    gridImportWithoutPvKwh: string;
    gridImportWithPvKwh: string;
    gridImportReductionKwh: string;
    gridImportReductionRate: string;
    pvGenerationKwh: string;
    selfConsumedPvKwh: string;
    exportedPvKwh: string;
    curtailedPvKwh: string;
    solarCoverageRate: string;
    selfConsumptionRate: string;
    coveredSolarCoverageRate: string;
    coveredGridImportReductionRate: string;
  };
  quality: {
    totalIntervals: number;
    missingLoadIntervals: number;
    noReferencePvIntervals: number;
    daysWithoutAnyReferencePv: number;
    referencePvCoverageRate: string;
    dstAmbiguousIntervals: number;
  };
  monthly: MonthlyRow[];
  monthlyTotal: MonthlyRow;
  detailColumns: string[];
  previewRows: string[][];
  detailRowCount: number;
  truncated: boolean;
  warnings: string[];
};

export type RunSimulationResult =
  | { ok: true; preview: SimulationPreview }
  | { ok: false; error: string; warnings?: string[] };

export type ExportSimulationResult =
  | { ok: true; filename: string; mimeType: string; base64: string; rowCount: number }
  | { ok: false; error: string };

type ResolvedRequest = {
  referencePlant: NonNullable<Awaited<ReturnType<typeof getReferencePlant>>>;
  targetCapacityKwp: number;
  mode: SimulationMode;
  unitMode: LoadProfileUnitMode;
  restrictStartUtc?: Date;
  restrictEndUtc?: Date;
  rows: SheetRows;
};

function isMode(v: unknown): v is SimulationMode {
  return v === "self_consumption_only" || v === "self_consumption_plus_export";
}
function isUnitMode(v: unknown): v is LoadProfileUnitMode {
  return v === "kwh_interval" || v === "kw_average";
}

async function resolveRequest(
  formData: FormData,
): Promise<{ ok: true; value: ResolvedRequest } | { ok: false; error: string }> {
  await requirePlatformAdmin();

  const referencePlantId = String(formData.get("referencePlantId") ?? "");
  const referencePlant = await getReferencePlant(referencePlantId);
  if (!referencePlant) {
    return { ok: false, error: "That reference PV plant could not be found." };
  }
  if (!(referencePlant.referenceCapacityKwp > 0)) {
    return { ok: false, error: "The reference PV plant has no installed capacity (kWp) configured." };
  }

  const capacityRaw = String(formData.get("capacityKwp") ?? "").trim();
  const targetCapacityKwp = Number(capacityRaw);
  if (!Number.isFinite(targetCapacityKwp) || targetCapacityKwp <= 0) {
    return { ok: false, error: "Enter a PV capacity greater than 0 kWp." };
  }
  if (targetCapacityKwp > 1_000_000) {
    return { ok: false, error: "PV capacity is unrealistically large." };
  }

  const mode = formData.get("mode");
  if (!isMode(mode)) {
    return { ok: false, error: "Choose a simulation mode." };
  }
  const unitMode = formData.get("unitMode");
  if (!isUnitMode(unitMode)) {
    return { ok: false, error: "Choose how the load profile values are expressed." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Upload the customer load-profile Excel file." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: `The file is larger than ${MAX_FILE_BYTES / (1024 * 1024)} MB.` };
  }
  const name = file.name.toLowerCase();
  if (!name.endsWith(".xlsx")) {
    return { ok: false, error: "Upload an .xlsx file (Excel workbook)." };
  }

  let rows: SheetRows;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    rows = (await readSheet(buffer, 1)) as unknown as SheetRows;
  } catch {
    return { ok: false, error: "The file could not be read as an Excel workbook." };
  }
  if (!Array.isArray(rows) || rows.length < 2) {
    return { ok: false, error: "The workbook's first sheet has no data rows." };
  }
  if (rows.length > MAX_INTERVALS / 96 + 2) {
    return {
      ok: false,
      error: "The load profile is too long — restrict it to a few years and try again.",
    };
  }

  // Optional date-range restriction, interpreted in the reference plant's timezone.
  const tz = referencePlant.timezone;
  const parseDate = (raw: string): { y: number; m: number; d: number } | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
    return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
  };
  const startRaw = String(formData.get("restrictStart") ?? "").trim();
  const endRaw = String(formData.get("restrictEnd") ?? "").trim();
  let restrictStartUtc: Date | undefined;
  let restrictEndUtc: Date | undefined;
  if (startRaw) {
    const d = parseDate(startRaw);
    if (!d) return { ok: false, error: "The restriction start date is not a valid date." };
    restrictStartUtc = zonedTimeToUtc(d.y, d.m, d.d, 0, 0, tz);
  }
  if (endRaw) {
    const d = parseDate(endRaw);
    if (!d) return { ok: false, error: "The restriction end date is not a valid date." };
    // Inclusive end day → exclusive next-midnight boundary.
    restrictEndUtc = new Date(zonedTimeToUtc(d.y, d.m, d.d, 0, 0, tz).getTime() + 24 * 3600 * 1000);
  }
  if (restrictStartUtc && restrictEndUtc && restrictStartUtc.getTime() >= restrictEndUtc.getTime()) {
    return { ok: false, error: "The restriction start must be on or before the end." };
  }

  return {
    ok: true,
    value: {
      referencePlant,
      targetCapacityKwp,
      mode,
      unitMode,
      restrictStartUtc,
      restrictEndUtc,
      rows,
    },
  };
}

async function simulate(req: ResolvedRequest) {
  const parsed = parseLoadProfile(req.rows, {
    timeZone: req.referencePlant.timezone,
    unitMode: req.unitMode,
  });
  if (!parsed.ok) {
    return { ok: false as const, error: parsed.errors.join(" ") };
  }

  const outcome = await generateSimulation({
    referencePlant: req.referencePlant,
    loadIntervals: parsed.intervals,
    targetCapacityKwp: req.targetCapacityKwp,
    mode: req.mode,
    restrictStartUtc: req.restrictStartUtc,
    restrictEndUtc: req.restrictEndUtc,
  });

  if (outcome.result.intervals.length === 0) {
    return { ok: false as const, error: "No load-profile intervals fall inside the selected date range." };
  }

  const warnings = parsed.warnings.map((w) => w.message);
  return { ok: true as const, outcome, warnings };
}

function periodLabel(startUtc: Date, endUtc: Date, timeZone: string): string {
  const s = formatWallClockTimestamp(startUtc, timeZone);
  const e = formatWallClockTimestamp(new Date(endUtc.getTime() - 1), timeZone);
  return `${s.slice(0, 10)} – ${e.slice(0, 10)} (${timeZone})`;
}

export async function runSimulationPreview(formData: FormData): Promise<RunSimulationResult> {
  const resolved = await resolveRequest(formData);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  let sim: Awaited<ReturnType<typeof simulate>>;
  try {
    sim = await simulate(resolved.value);
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof SimulationValidationError
          ? error.message
          : "The simulation could not be completed.",
    };
  }
  if (!sim.ok) return { ok: false, error: sim.error };

  const { outcome, warnings } = sim;
  const { result } = outcome;
  const t = result.total;
  const r = result.totalRates;
  const q = result.quality;

  const toMonthlyRow = (
    month: string,
    tt: typeof t,
    rr: typeof r,
  ): MonthlyRow => ({
    month,
    consumptionKwh: kwh(tt.consumptionKwh),
    gridImportWithoutPvKwh: kwh(tt.gridImportWithoutPvKwh),
    gridImportWithPvKwh: kwh(tt.gridImportWithPvKwh),
    pvGenerationKwh: kwh(tt.pvGenerationKwh),
    pvUsedOnSiteKwh: kwh(tt.pvUsedOnSiteKwh),
    pvCurtailedKwh: kwh(tt.pvCurtailedKwh),
    gridExportKwh: kwh(tt.gridExportKwh),
    selfConsumptionRate: pct(rr.selfConsumptionRate),
    solarCoverageRate: pct(rr.solarCoverageRate),
  });

  const preview: SimulationPreview = {
    referencePlantName: resolved.value.referencePlant.name,
    referenceOrganizationName: resolved.value.referencePlant.organizationName,
    referenceCapacityKwp: resolved.value.referencePlant.referenceCapacityKwp,
    targetCapacityKwp: resolved.value.targetCapacityKwp,
    mode: result.mode,
    modeLabel: MODE_LABEL[result.mode],
    timeZone: result.timeZone,
    periodLabel: periodLabel(outcome.windowStartUtc, outcome.windowEndUtc, result.timeZone),
    summary: {
      totalConsumptionKwh: kwh(t.consumptionKwh),
      gridImportWithoutPvKwh: kwh(t.gridImportWithoutPvKwh),
      gridImportWithPvKwh: kwh(t.gridImportWithPvKwh),
      gridImportReductionKwh: kwh(r.gridImportReductionKwh),
      gridImportReductionRate: pct(r.gridImportReductionRate),
      pvGenerationKwh: kwh(t.pvGenerationKwh),
      selfConsumedPvKwh: kwh(t.pvUsedOnSiteKwh),
      exportedPvKwh: kwh(t.gridExportKwh),
      curtailedPvKwh: kwh(t.pvCurtailedKwh),
      solarCoverageRate: pct(r.solarCoverageRate),
      selfConsumptionRate: pct(r.selfConsumptionRate),
      coveredSolarCoverageRate: pct(r.coveredSolarCoverageRate),
      coveredGridImportReductionRate: pct(r.coveredGridImportReductionRate),
    },
    quality: {
      totalIntervals: q.totalIntervals,
      missingLoadIntervals: q.missingLoadIntervals,
      noReferencePvIntervals: q.noReferencePvIntervals,
      daysWithoutAnyReferencePv: q.daysWithoutAnyReferencePv,
      referencePvCoverageRate: pct(q.referencePvCoverageRate),
      dstAmbiguousIntervals: q.dstAmbiguousIntervals,
    },
    monthly: result.monthly.map((m) => toMonthlyRow(m.month, m.totals, m.rates)),
    monthlyTotal: toMonthlyRow("TOTAL", t, r),
    detailColumns: DETAIL_COLUMNS.map((c) => c.header),
    previewRows: result.intervals.slice(0, PREVIEW_DETAIL_ROWS).map((iv) => [
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
      MODE_LABEL[result.mode],
      String(resolved.value.targetCapacityKwp),
    ]),
    detailRowCount: result.intervals.length,
    truncated: result.intervals.length > PREVIEW_DETAIL_ROWS,
    warnings,
  };

  return { ok: true, preview };
}

export async function exportSimulation(formData: FormData): Promise<ExportSimulationResult> {
  const formatRaw = formData.get("format");
  if (formatRaw !== "csv" && formatRaw !== "xlsx") {
    return { ok: false, error: "Choose CSV or XLSX." };
  }
  const format: ExportFormat = formatRaw;

  const resolved = await resolveRequest(formData);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  let sim: Awaited<ReturnType<typeof simulate>>;
  try {
    sim = await simulate(resolved.value);
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof SimulationValidationError
          ? error.message
          : "The simulation could not be completed.",
    };
  }
  if (!sim.ok) return { ok: false, error: sim.error };

  const { outcome, warnings } = sim;
  const { result } = outcome;
  const startDate = formatWallClockTimestamp(outcome.windowStartUtc, result.timeZone).slice(0, 10);
  const endDate = formatWallClockTimestamp(
    new Date(outcome.windowEndUtc.getTime() - 1),
    result.timeZone,
  ).slice(0, 10);
  const filename = simulationFilename(
    resolved.value.referencePlant.name,
    resolved.value.targetCapacityKwp,
    result.mode,
    startDate,
    endDate,
    format,
  );

  let base64: string;
  if (format === "csv") {
    base64 = Buffer.from(toDetailCsv(result), "utf-8").toString("base64");
  } else {
    const buffer = await toSimulationXlsxBuffer(result, {
      referencePlantName: resolved.value.referencePlant.name,
      referenceOrganizationName: resolved.value.referencePlant.organizationName,
      referenceCapacityKwp: resolved.value.referencePlant.referenceCapacityKwp,
      periodLabel: periodLabel(outcome.windowStartUtc, outcome.windowEndUtc, result.timeZone),
      generatedAt: new Date(),
      loadProfileWarnings: warnings,
    });
    base64 = buffer.toString("base64");
  }

  return {
    ok: true,
    filename,
    mimeType: MIME[format],
    base64,
    rowCount: result.intervals.length,
  };
}
