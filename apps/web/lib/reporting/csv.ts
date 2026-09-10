/**
 * Admin Reporting feature — CSV exporter. Pure; unit-tested in `csv.test.ts`.
 *
 * - UTF-8 with a BOM (so Excel opens it as UTF-8 without a manual import).
 * - `\r\n` line endings (RFC 4180).
 * - Deterministic column order: `Timestamp` then the selected metrics in
 *   `METRIC_KEYS` order (never an unselected metric).
 * - RFC 4180 quoting: a field is wrapped in `"` when it contains `,`, `"`,
 *   `\r`, or `\n`; embedded `"` is doubled.
 * - One row per 15-minute interval; the final row is the `TOTAL` row, whose
 *   first cell is the literal `TOTAL` (never a timestamp).
 * - A missing value is an empty field — never `0`.
 */

import { metricHeader, type MetricKey } from "./metrics";
import type { ReportResult } from "./build-report";
import { csvDocument, csvField } from "./export-shared";
import { formatIntervalTimestamp, formatMetricValue } from "./serialize";

// Re-exported: `csvField` originally lived here and `csv.test.ts` imports it from this module.
export { csvField };

export function toCsv(report: ReportResult): string {
  const metrics: MetricKey[] = report.metrics;

  const rows: string[][] = [
    ["Timestamp", ...metrics.map((metric) => metricHeader(metric, report.currency))],
    ...report.rows.map((row) => [
      formatIntervalTimestamp(row.intervalStart, report.timeZone),
      ...metrics.map((metric) => formatMetricValue(row.values[metric] ?? null, metric)),
    ]),
    [
      report.totals.label,
      ...metrics.map((metric) => formatMetricValue(report.totals.values[metric] ?? null, metric)),
    ],
  ];

  return csvDocument(rows);
}
