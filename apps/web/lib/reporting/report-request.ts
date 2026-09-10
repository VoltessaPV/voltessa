/**
 * Admin Reporting feature — server-side request parsing and validation.
 *
 * Pure and self-contained (no I/O, no Prisma) so every rule is unit-tested
 * in `report-request.test.ts`. The Server Actions in
 * `app/admin/reporting/actions.ts` call `parseReportRequest` after the
 * `requirePlatformAdmin()` gate and after resolving the plant (and its
 * canonical `Plant.timezone`) from the database — this function never sees
 * a client-supplied timezone or organization id.
 *
 * Timezone handling reuses `lib/market-price/timezone.ts`'s `zonedTimeToUtc`
 * (DST-exact, `Intl`-based, no date library) and the 15-minute grid is the
 * same one `MarketPrice` rows and `lib/telemetry/energy-metrics.ts` use —
 * `floorToInterval` is imported from the Market Price Provider, not
 * re-implemented.
 */

import { floorToInterval } from "@/lib/market-price/provider";
import { zonedTimeToUtc } from "@/lib/market-price/timezone";

import { METRIC_KEYS, REPORT_INTERVAL_MINUTES, isMetricKey, orderMetrics, type MetricKey } from "./metrics";

export const EXPORT_FORMATS = ["csv", "xlsx"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function isExportFormat(value: unknown): value is ExportFormat {
  return typeof value === "string" && (EXPORT_FORMATS as readonly string[]).includes(value);
}

/**
 * Maximum reporting window, enforced server-side in every action and shown
 * in the UI. One calendar quarter — at 15-minute resolution that is at most
 * 8 928 rows, each a single indexed range read plus a linear cursor walk
 * over `DeviceTelemetry` / `MarketPrice` (never a query per interval). Large
 * enough for any realistic monthly/quarterly report, bounded enough to keep
 * one request predictable.
 */
export const MAX_REPORT_RANGE_DAYS = 93;

const DAY_MS = 24 * 60 * 60 * 1000;
const INTERVAL_MS = REPORT_INTERVAL_MINUTES * 60 * 1000;

/** Local-datetime input as produced by an `<input type="datetime-local">`. */
const LOCAL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export type RawReportRequest = {
  plantId?: unknown;
  start?: unknown;
  end?: unknown;
  metrics?: unknown;
  format?: unknown;
};

export type ParsedReportRequest = {
  plantId: string;
  metrics: MetricKey[];
  format: ExportFormat;
  /** Wall-clock start/end the admin typed, echoed back for labels. */
  startLocal: string;
  endLocal: string;
  /**
   * `[start, end)` UTC instants, each snapped to the 15-minute grid
   * (`start` floored, `end` ceiled) so the report's rows line up exactly
   * with `MarketPrice.timestamp` and the settlement-energy grid.
   */
  startUtc: Date;
  endUtc: Date;
  intervalCount: number;
};

export type ParseReportRequestResult =
  | { ok: true; value: ParsedReportRequest }
  | { ok: false; error: string };

function ceilToInterval(date: Date): Date {
  return new Date(Math.ceil(date.getTime() / INTERVAL_MS) * INTERVAL_MS);
}

function parseLocalDateTime(value: string, timeZone: string): Date | null {
  const match = LOCAL_DATETIME_RE.exec(value);
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute] = match.map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return null;
  }

  const utc = zonedTimeToUtc(year, month, day, hour, minute, timeZone);

  // `zonedTimeToUtc` never throws on an out-of-range calendar date, it
  // rolls over — reject anything that didn't round-trip to the same
  // wall-clock date in `timeZone` (e.g. 2026-02-30).
  const roundTrip = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(utc);
  if (roundTrip !== `${match[1]}-${match[2]}-${match[3]}`) {
    return null;
  }

  return utc;
}

/**
 * `timeZone` is the plant's own canonical `Plant.timezone`, resolved from
 * the database by the caller — never a client value.
 */
export function parseReportRequest(
  raw: RawReportRequest,
  timeZone: string,
): ParseReportRequestResult {
  if (typeof raw.plantId !== "string" || raw.plantId.trim() === "") {
    return { ok: false, error: "Select a plant." };
  }

  if (!isExportFormat(raw.format)) {
    return { ok: false, error: "Choose CSV or XLSX." };
  }

  if (!Array.isArray(raw.metrics) || raw.metrics.length === 0) {
    return { ok: false, error: "Select at least one metric." };
  }
  if (!raw.metrics.every(isMetricKey)) {
    return { ok: false, error: "One or more selected metrics are not recognised." };
  }
  const metrics = orderMetrics(raw.metrics as MetricKey[]);
  if (metrics.length === 0 || metrics.length > METRIC_KEYS.length) {
    return { ok: false, error: "Select at least one metric." };
  }

  if (typeof raw.start !== "string" || typeof raw.end !== "string") {
    return { ok: false, error: "Enter a start and end date/time." };
  }

  const startExact = parseLocalDateTime(raw.start, timeZone);
  const endExact = parseLocalDateTime(raw.end, timeZone);
  if (!startExact || !endExact) {
    return { ok: false, error: "Start or end date/time is not a valid date." };
  }

  if (startExact.getTime() >= endExact.getTime()) {
    return { ok: false, error: "The start must be before the end." };
  }

  const startUtc = floorToInterval(startExact, REPORT_INTERVAL_MINUTES);
  const endUtc = ceilToInterval(endExact);

  if (startUtc.getTime() >= endUtc.getTime()) {
    return { ok: false, error: "The selected range is shorter than one 15-minute interval." };
  }

  const spanMs = endUtc.getTime() - startUtc.getTime();
  if (spanMs > MAX_REPORT_RANGE_DAYS * DAY_MS) {
    return {
      ok: false,
      error: `The reporting period cannot exceed ${MAX_REPORT_RANGE_DAYS} days. Narrow the range and try again.`,
    };
  }

  return {
    ok: true,
    value: {
      plantId: raw.plantId,
      metrics,
      format: raw.format,
      startLocal: raw.start,
      endLocal: raw.end,
      startUtc,
      endUtc,
      intervalCount: Math.round(spanMs / INTERVAL_MS),
    },
  };
}
