/**
 * Admin Reporting feature — XLSX exporter. A real structured workbook (via
 * `write-excel-file`, the smallest maintained library that covers frozen
 * header rows, per-column number formats, column widths and a styled total
 * row), never a CSV string in an `.xlsx` wrapper.
 *
 * Two sheets:
 * - **Report** — `Timestamp` + selected metric columns, one row per
 *   15-minute interval, then the styled `TOTAL` row. Metric cells are real
 *   numeric cells with an energy/price/revenue number format; a missing
 *   value is a genuinely empty cell, never `0`. The timestamp column is a
 *   `YYYY-MM-DD HH:mm` string in the plant timezone (a real date cell would
 *   lose the timezone and mislead a reader in another zone).
 * - **Report Info** — plant, period, generation time, interval, selected
 *   metrics, currency, timezone.
 */

import writeXlsxFile from "write-excel-file/node";

import { getMetricDefinition, metricHeader, type MetricKey } from "./metrics";
import type { ReportResult } from "./build-report";
import { formatIntervalTimestamp, toMetricNumber } from "./serialize";

type XlsxCell =
  | null
  | {
      value?: string | number;
      type?: StringConstructor | NumberConstructor;
      format?: string;
      fontWeight?: "bold";
      backgroundColor?: string;
    };

const TOTAL_FILL = "#EEF2F7";

function metricNumberFormat(metric: MetricKey): string {
  const group = getMetricDefinition(metric).group;
  if (group === "financial") {
    return metric === "price" ? "#,##0.00" : "#,##0.0000";
  }
  return "#,##0.000";
}

function metricColumnWidth(metric: MetricKey): number {
  return getMetricDefinition(metric).group === "financial" ? 16 : 20;
}

export type ReportXlsxMeta = {
  plantName: string;
  organizationName: string;
  generatedAt: Date;
  periodLabel: string;
};

export async function toXlsxBuffer(report: ReportResult, meta: ReportXlsxMeta): Promise<Buffer> {
  const metrics: MetricKey[] = report.metrics;

  const headerRow: XlsxCell[] = [
    { value: "Timestamp", fontWeight: "bold" },
    ...metrics.map<XlsxCell>((metric) => ({
      value: metricHeader(metric, report.currency),
      fontWeight: "bold",
    })),
  ];

  const dataRows: XlsxCell[][] = report.rows.map((row) => [
    { value: formatIntervalTimestamp(row.intervalStart, report.timeZone), type: String },
    ...metrics.map<XlsxCell>((metric) => {
      const value = toMetricNumber(row.values[metric] ?? null, metric);
      return value === null ? null : { value, type: Number, format: metricNumberFormat(metric) };
    }),
  ]);

  const totalRow: XlsxCell[] = [
    { value: report.totals.label, type: String, fontWeight: "bold", backgroundColor: TOTAL_FILL },
    ...metrics.map<XlsxCell>((metric) => {
      const value = toMetricNumber(report.totals.values[metric] ?? null, metric);
      return value === null
        ? { backgroundColor: TOTAL_FILL }
        : {
            value,
            type: Number,
            format: metricNumberFormat(metric),
            fontWeight: "bold",
            backgroundColor: TOTAL_FILL,
          };
    }),
  ];

  const reportSheet = {
    sheet: "Report",
    stickyRowsCount: 1,
    columns: [{ width: 18 }, ...metrics.map((metric) => ({ width: metricColumnWidth(metric) }))],
    data: [headerRow, ...dataRows, totalRow],
  };

  const infoPairs: Array<[string, string]> = [
    ["Plant", meta.plantName],
    ["Organization", meta.organizationName],
    ["Period", meta.periodLabel],
    ["Timezone", report.timeZone],
    ["Interval", `${report.intervalMinutes} minutes`],
    ["Rows (15-minute intervals)", String(report.rowCount)],
    ["Metrics", metrics.map((metric) => getMetricDefinition(metric).label).join(", ")],
    ["Currency", report.currency],
    [
      "Market price import",
      report.priceImportPartial ? "Partial for the most recent day" : "Complete",
    ],
    ["Generated at (UTC)", meta.generatedAt.toISOString()],
  ];

  const infoSheet = {
    sheet: "Report Info",
    columns: [{ width: 28 }, { width: 64 }],
    data: infoPairs.map<XlsxCell[]>(([label, value]) => [
      { value: label, fontWeight: "bold" },
      { value, type: String },
    ]),
  };

  // `write-excel-file`'s multi-sheet parameter type is derived here rather
  // than reconstructed: the cell shapes above follow its documented cell
  // object contract (`value`/`type`/`format`/`fontWeight`/`backgroundColor`).
  const sheets = [reportSheet, infoSheet] as unknown as Parameters<typeof writeXlsxFile>[0];
  const buffer = await writeXlsxFile(sheets).toBuffer();
  return buffer as Buffer;
}
