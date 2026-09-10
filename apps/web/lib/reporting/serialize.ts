/**
 * Admin Reporting feature — shared, locale-independent serialisation
 * helpers used by both the CSV and XLSX exporters and the UI preview, so
 * timestamp, number, and filename formatting can never drift between them.
 * Pure; unit-tested in `csv.test.ts`.
 */

import { metricDecimals, type MetricKey } from "./metrics";

/**
 * `YYYY-MM-DD HH:mm` for the interval-start instant, in the plant's
 * timezone. Uses `Intl.DateTimeFormat` (IANA tz database, DST-correct) —
 * never manual offset arithmetic. This is the interval **start**; a period
 * crossing a DST transition produces the right number of rows because the
 * underlying grid steps in fixed 15-minute UTC increments (see
 * `generate-report.ts`), and this only ever relabels those instants.
 */
export function formatIntervalTimestamp(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/**
 * A human-readable label for the reporting window, in the plant timezone,
 * e.g. `01 Sep 2026 00:00 – 07 Sep 2026 00:00 (Europe/Sofia)`. `endUtc` is
 * the exclusive grid boundary, shown as-is (it is the first instant *not*
 * covered).
 */
export function formatReportPeriodLabel(startUtc: Date, endUtc: Date, timeZone: string): string {
  const fmt = (instant: Date) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(instant);
  return `${fmt(startUtc)} – ${fmt(endUtc)} (${timeZone})`;
}

/**
 * A metric value as a fixed-decimal string (`.` decimal separator, no
 * thousands separator, no locale). `null` → empty string — a missing value
 * is never rendered as `0`.
 */
export function formatMetricValue(value: number | null, metric: MetricKey): string {
  if (value === null || Number.isNaN(value)) {
    return "";
  }
  return value.toFixed(metricDecimals(metric));
}

/**
 * A metric value as a real number for an XLSX numeric cell, or `null` for a
 * blank cell. Rounded to the metric's fixed precision so the stored cell
 * matches what the CSV shows.
 */
export function toMetricNumber(value: number | null, metric: MetricKey): number | null {
  if (value === null || Number.isNaN(value)) {
    return null;
  }
  const factor = 10 ** metricDecimals(metric);
  return Math.round(value * factor) / factor;
}

/**
 * A filesystem-safe slug for a plant name: NFKD-folded, ASCII lower-case,
 * every run of non `[a-z0-9]` characters (spaces, punctuation, combining
 * marks, path separators, `..`, control characters, anything non-ASCII)
 * collapsed to a single `-`, trimmed, capped at 60 chars. Never empty
 * (`"plant"` fallback). No user text can produce an unsafe or traversing
 * filename after this.
 */
export function slugifyPlantName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
  return slug || "plant";
}

/**
 * `voltessa-{plant-slug}-report-{start}-{end}.{ext}`. `start`/`end` are the
 * plant-local calendar dates of the reporting window. `ext` is `"csv"` or
 * `"xlsx"`. Fully deterministic and safe — no user text reaches the name
 * except through `slugifyPlantName`.
 */
export function reportFilename(
  plantName: string,
  periodStartUtc: Date,
  periodEndUtc: Date,
  timeZone: string,
  ext: "csv" | "xlsx",
): string {
  const dateOnly = (instant: Date) => formatIntervalTimestamp(instant, timeZone).slice(0, 10);
  // The window is half-open `[start, end)`; label it by its last *covered*
  // day, not the exclusive end boundary.
  const lastCovered = new Date(periodEndUtc.getTime() - 1);
  return `voltessa-${slugifyPlantName(plantName)}-report-${dateOnly(periodStartUtc)}-${dateOnly(lastCovered)}.${ext}`;
}
