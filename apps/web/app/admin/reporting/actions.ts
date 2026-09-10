"use server";

import { getReportingPlant } from "@/lib/admin/reporting-queries";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { toCsv } from "@/lib/reporting/csv";
import { generateReport } from "@/lib/reporting/generate-report";
import { getMetricDefinition, metricHeader, type MetricKey } from "@/lib/reporting/metrics";
import {
  parseReportRequest,
  type ExportFormat,
  type RawReportRequest,
} from "@/lib/reporting/report-request";
import {
  formatIntervalTimestamp,
  formatMetricValue,
  formatReportPeriodLabel,
  reportFilename,
} from "@/lib/reporting/serialize";
import { toXlsxBuffer } from "@/lib/reporting/xlsx";

/**
 * Admin Reporting — the two Server Actions the page uses. Every action
 * independently calls `requirePlatformAdmin()` (a layout render never
 * protects a Server Action's own RPC — see `lib/auth/session.ts`) and
 * re-resolves the plant from the database by id, so an organization id or
 * timezone from the browser is never trusted. Non-admin callers hit the
 * app's standard `forbidden()` (403) path; unauthenticated callers are
 * redirected to `/login` by `requireCurrentUser()` inside it.
 */

/** How many interval rows the preview returns — the full data set is only ever built for the file download. */
const PREVIEW_ROW_LIMIT = 500;

const MIME_BY_FORMAT: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export type ReportPreviewColumn = { key: "timestamp" | MetricKey; label: string };

export type ReportPreview = {
  plantName: string;
  organizationName: string;
  periodLabel: string;
  timeZone: string;
  currency: string;
  intervalMinutes: number;
  rowCount: number;
  metrics: MetricKey[];
  columns: ReportPreviewColumn[];
  /** Formatted, at most `PREVIEW_ROW_LIMIT` rows. `""` = missing value. */
  previewRows: string[][];
  /** Formatted TOTAL row; first cell is the literal `TOTAL`. */
  totalRow: string[];
  truncated: boolean;
  completeness: Array<{ metric: MetricKey; label: string; withData: number; total: number }>;
  priceImportPartial: boolean;
  revenue:
    | { available: true; revenueEur: number; exportedKwh: number; averagePriceEurPerMwh: number | null }
    | { available: false };
};

export type GenerateReportPreviewResult =
  | { ok: true; preview: ReportPreview }
  | { ok: false; error: string };

export type ExportReportResult =
  | { ok: true; filename: string; mimeType: string; base64: string; rowCount: number }
  | { ok: false; error: string };

async function resolveRequest(input: RawReportRequest) {
  await requirePlatformAdmin();

  const plantId = typeof input.plantId === "string" ? input.plantId : "";
  const plant = await getReportingPlant(plantId);
  if (!plant) {
    return { ok: false as const, error: "That plant could not be found." };
  }

  const parsed = parseReportRequest(input, plant.timezone);
  if (!parsed.ok) {
    return { ok: false as const, error: parsed.error };
  }

  return { ok: true as const, plant, request: parsed.value };
}

export async function generateReportPreview(
  input: RawReportRequest,
): Promise<GenerateReportPreviewResult> {
  const resolved = await resolveRequest(input);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error };
  }

  const { plant, request } = resolved;
  const report = await generateReport({
    plantId: plant.id,
    timeZone: plant.timezone,
    startUtc: request.startUtc,
    endUtc: request.endUtc,
    metrics: request.metrics,
  });

  const columns: ReportPreviewColumn[] = [
    { key: "timestamp", label: "Timestamp" },
    ...report.metrics.map<ReportPreviewColumn>((metric) => ({
      key: metric,
      label: metricHeader(metric, report.currency),
    })),
  ];

  const previewRows = report.rows.slice(0, PREVIEW_ROW_LIMIT).map((row) => [
    formatIntervalTimestamp(row.intervalStart, report.timeZone),
    ...report.metrics.map((metric) => formatMetricValue(row.values[metric] ?? null, metric)),
  ]);

  const totalRow = [
    report.totals.label,
    ...report.metrics.map((metric) => formatMetricValue(report.totals.values[metric] ?? null, metric)),
  ];

  return {
    ok: true,
    preview: {
      plantName: plant.name,
      organizationName: plant.organizationName,
      periodLabel: formatReportPeriodLabel(report.periodStartUtc, report.periodEndUtc, report.timeZone),
      timeZone: report.timeZone,
      currency: report.currency,
      intervalMinutes: report.intervalMinutes,
      rowCount: report.rowCount,
      metrics: report.metrics,
      columns,
      previewRows,
      totalRow,
      truncated: report.rowCount > previewRows.length,
      completeness: report.completeness.map((entry) => ({
        metric: entry.metric,
        label: getMetricDefinition(entry.metric).label,
        withData: entry.withData,
        total: entry.total,
      })),
      priceImportPartial: report.priceImportPartial,
      revenue: report.revenue.available
        ? {
            available: true,
            revenueEur: report.revenue.revenueEur,
            exportedKwh: report.revenue.exportedKwh,
            averagePriceEurPerMwh: report.revenue.averagePriceEurPerMwh,
          }
        : { available: false },
    },
  };
}

export async function exportReport(input: RawReportRequest): Promise<ExportReportResult> {
  const resolved = await resolveRequest(input);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error };
  }

  const { plant, request } = resolved;
  const report = await generateReport({
    plantId: plant.id,
    timeZone: plant.timezone,
    startUtc: request.startUtc,
    endUtc: request.endUtc,
    metrics: request.metrics,
  });

  const filename = reportFilename(
    plant.name,
    report.periodStartUtc,
    report.periodEndUtc,
    report.timeZone,
    request.format,
  );

  let base64: string;
  if (request.format === "csv") {
    base64 = Buffer.from(toCsv(report), "utf-8").toString("base64");
  } else {
    const buffer = await toXlsxBuffer(report, {
      plantName: plant.name,
      organizationName: plant.organizationName,
      generatedAt: new Date(),
      periodLabel: formatReportPeriodLabel(report.periodStartUtc, report.periodEndUtc, report.timeZone),
    });
    base64 = buffer.toString("base64");
  }

  return {
    ok: true,
    filename,
    mimeType: MIME_BY_FORMAT[request.format],
    base64,
    rowCount: report.rowCount,
  };
}
