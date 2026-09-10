/**
 * Admin Reporting feature — the fixed catalogue of the seven metrics an
 * administrator can select for a 15-minute interval report, and the
 * canonical Voltessa source each one is derived from (see
 * `docs/CANONICAL_ENTITY_CONTRACT.md` and `lib/reporting/build-report.ts`).
 *
 * This module holds no data logic — only the metric identifiers, their
 * human-readable labels, units, and stable column order. Nothing here
 * defines how a value is computed; that is `build-report.ts`, which only
 * ever composes existing canonical functions
 * (`lib/telemetry/energy-metrics.ts`, `lib/market-price/revenue.ts`,
 * `lib/market-price/provider.ts`).
 */

export const REPORT_INTERVAL_MINUTES = 15;

/**
 * Every selectable metric, in the exact, stable column order used by the
 * UI preview, the CSV, and the XLSX. `Timestamp` is always the first
 * column and is not part of this list (it is not optional).
 */
export const METRIC_KEYS = [
  "pvProduction",
  "totalConsumption",
  "gridConsumption",
  "pvConsumption",
  "gridExport",
  "price",
  "revenue",
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

export type MetricGroup = "energy" | "financial";

export type MetricDefinition = {
  key: MetricKey;
  /** Human-readable label, no unit. */
  label: string;
  group: MetricGroup;
  /**
   * Canonical unit. For the two financial metrics this is the *default*
   * (EUR); the actual currency comes from `MarketPrice.currency` at report
   * time and is substituted by `metricHeader()` below.
   */
  unit: string;
};

export const REPORT_METRICS: readonly MetricDefinition[] = [
  { key: "pvProduction", label: "PV Production", group: "energy", unit: "kWh" },
  { key: "totalConsumption", label: "Total Consumption", group: "energy", unit: "kWh" },
  { key: "gridConsumption", label: "Grid Consumption", group: "energy", unit: "kWh" },
  { key: "pvConsumption", label: "PV Consumption", group: "energy", unit: "kWh" },
  { key: "gridExport", label: "Grid Export", group: "energy", unit: "kWh" },
  { key: "price", label: "Price", group: "financial", unit: "EUR/MWh" },
  { key: "revenue", label: "Revenue", group: "financial", unit: "EUR" },
] as const;

const METRIC_BY_KEY: Record<MetricKey, MetricDefinition> = Object.fromEntries(
  REPORT_METRICS.map((metric) => [metric.key, metric]),
) as Record<MetricKey, MetricDefinition>;

export function getMetricDefinition(key: MetricKey): MetricDefinition {
  return METRIC_BY_KEY[key];
}

export function isMetricKey(value: unknown): value is MetricKey {
  return typeof value === "string" && (METRIC_KEYS as readonly string[]).includes(value);
}

/**
 * Sorts an arbitrary selection into the canonical `METRIC_KEYS` order and
 * removes duplicates — so column order is deterministic regardless of the
 * order the checkboxes were toggled in.
 */
export function orderMetrics(selected: readonly MetricKey[]): MetricKey[] {
  const set = new Set(selected);
  return METRIC_KEYS.filter((key) => set.has(key));
}

/**
 * The exact column header for a metric, e.g. `"PV Production (kWh)"` or
 * `"Price (EUR/MWh)"`. `currency` (from `MarketPrice.currency`, canonical
 * "EUR" today) replaces the `EUR` token in the two financial metrics so a
 * future non-EUR bidding zone needs no change here.
 */
export function metricHeader(key: MetricKey, currency: string): string {
  const definition = getMetricDefinition(key);
  const unit =
    definition.group === "financial"
      ? definition.unit.replace("EUR", currency)
      : definition.unit;
  return `${definition.label} (${unit})`;
}

/** Number of decimal places each metric is serialised with — fixed, locale-independent. */
export function metricDecimals(key: MetricKey): number {
  switch (key) {
    case "price":
      return 2;
    case "revenue":
      return 4;
    default:
      return 3;
  }
}
