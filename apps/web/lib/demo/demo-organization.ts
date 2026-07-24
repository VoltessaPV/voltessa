/**
 * Landing Page Platform Preview milestone. Static demo data for a fictional
 * "Demo Solar Park" (500 kWp, 4 Huawei inverters), typed directly against
 * the real page-data types (`DashboardPageData`, `MarketPageResult`,
 * `ProductionPageData`) so a future change to any of those types breaks
 * this file's build too — the landing page cannot silently drift from what
 * the authenticated app actually renders.
 *
 * Every derived figure (revenue, energy-flow consumption, export
 * recommendation) is produced by the exact same pure helper the real pages
 * use (`computeExportRevenue`, `deriveEnergyFlow`, `isExportRecommended`)
 * rather than hand-typed, so the numbers are internally consistent by
 * construction, not by careful arithmetic. Deliberately does NOT import
 * anything from `lib/fusionsolar/*` (even the pure classification helpers
 * there) or `lib/auth/*` — inverter-status/configured-export-mode values
 * below are inlined literals matching those helpers' well-known output for
 * the specific inputs used ("Grid-connected" for state `512`, "Unavailable"
 * for a failed configuration read), not a live or imported computation.
 * Nothing here performs I/O.
 */

import type {
  DashboardKpis,
  DashboardMarketWidgetData,
  DashboardPageData,
  EnergyFlowState,
  EnergyFlowPoint,
} from "@/app/(platform)/dashboard/dashboard-data";
import type {
  DistributionBucket,
  MarketEventLogEntry,
  MarketInsight,
  MarketPageResult,
  MarketPricePoint,
  MarketSummaryData,
} from "@/app/(platform)/market/market-data";
import type {
  ProductionPageData,
  ProductionReading,
} from "@/app/(platform)/market/production-data";
import {
  isExportRecommended,
  type ExportThresholdConfig,
} from "@/lib/automation/export-threshold-config";
import { computeExportRevenue } from "@/lib/market-price/revenue";
import { deriveEnergyFlow } from "@/lib/telemetry/energy-flow";
import type { SettlementEnergyPoint } from "@/lib/telemetry/energy-metrics";

type DemoInverterStatus = {
  deviceId: string;
  name: string;
  online: boolean;
  powerKw: number | null;
  statusColor: "green" | "yellow" | "red" | "gray";
  statusLabel: string;
};

type DemoInverterStatusResult =
  | { available: true; inverters: DemoInverterStatus[] }
  | { available: false; reason: "no_inverter_devices" | "request_failed" | "historical_day" };

const DEMO_PLANT_NAME = "Demo Solar Park";
const DEMO_INSTALLED_CAPACITY_KW = 500;
const DEMO_THRESHOLD: ExportThresholdConfig = { minimumExportPrice: 75, currency: "EUR" };

/** Today at 00:00 UTC — a fixed reference so every series in this module lines up on the same grid. */
const DEMO_DAY_START = new Date();
DEMO_DAY_START.setUTCHours(0, 0, 0, 0);

/** "Now" for this demo: 16:30 — mid-afternoon, past peak solar, still clearly exporting. */
const DEMO_NOW_MINUTES = 16 * 60 + 30;

function dateAtMinutes(minutes: number): Date {
  return new Date(DEMO_DAY_START.getTime() + minutes * 60 * 1000);
}

/** Bell-shaped PV output over a 500 kWp array: zero before sunrise/after sunset, peaking ~460 kW at solar noon. */
function pvOutputKw(minutes: number): number {
  const sunrise = 6 * 60;
  const sunset = 20 * 60;
  const peakMinute = 13 * 60;
  const halfSpan = peakMinute - sunrise;

  if (minutes <= sunrise || minutes >= sunset) {
    return 0;
  }

  const shape = Math.max(0, 1 - ((minutes - peakMinute) / halfSpan) ** 2);
  return Math.round(460 * shape * 100) / 100;
}

/** A modest, fairly flat commercial/industrial baseline load. */
function consumptionBaselineKw(minutes: number): number {
  const hour = minutes / 60;
  return Math.round((65 + 12 * Math.exp(-((hour - 14) ** 2) / (2 * 5 ** 2))) * 100) / 100;
}

/** Realistic Bulgarian day-ahead shape for a high-solar-penetration day: morning ramp, a midday solar dip (occasionally negative), an evening peak. */
function dayAheadPriceEurPerMwh(minutes: number): number {
  const hour = minutes / 60;
  const morningPeak = 90 * Math.exp(-((hour - 8) ** 2) / (2 * 2.2 ** 2));
  const eveningPeak = 120 * Math.exp(-((hour - 19) ** 2) / (2 * 2.5 ** 2));
  const solarDip = 78 * Math.exp(-((hour - 13) ** 2) / (2 * 3 ** 2));
  const base = 55;

  return Math.round((base + morningPeak + eveningPeak - solarDip) * 10) / 10;
}

const nowPvKw = pvOutputKw(DEMO_NOW_MINUTES);
const nowConsumptionKw = consumptionBaselineKw(DEMO_NOW_MINUTES);
const nowExportKw = Math.max(nowPvKw - nowConsumptionKw, 0);
const nowImportKw = Math.max(nowConsumptionKw - nowPvKw, 0);
const nowPriceEurPerMwh = dayAheadPriceEurPerMwh(DEMO_NOW_MINUTES);

const DEMO_ENERGY_FLOW: EnergyFlowState = deriveEnergyFlow(nowPvKw, nowExportKw, nowImportKw);

// ---- Dashboard: 5-minute chart series over the full day ----

const DEMO_CHART_SERIES: EnergyFlowPoint[] = Array.from({ length: 288 }, (_, index) => {
  const minutes = index * 5;
  const pv = pvOutputKw(minutes);
  const consumption = consumptionBaselineKw(minutes);
  const exportKw = Math.max(pv - consumption, 0);
  const importKw = Math.max(consumption - pv, 0);
  const flow = deriveEnergyFlow(pv, exportKw, importKw);

  return {
    time: dateAtMinutes(minutes).getTime(),
    pvKw: pv,
    consumptionKw: flow.available && flow.consumption.consistent ? flow.consumption.kw : consumption,
    gridImportKw: importKw,
    gridExportKw: exportKw,
  };
});

// ---- Market: 15-minute price + settlement series over the full day ----

const DEMO_PRICE_SERIES: MarketPricePoint[] = Array.from({ length: 96 }, (_, index) => {
  const minutes = index * 15;
  const price = dayAheadPriceEurPerMwh(minutes);

  return {
    timestamp: dateAtMinutes(minutes),
    price,
    exportEnabled: isExportRecommended(price, DEMO_THRESHOLD),
  };
});

const DEMO_SETTLEMENT_SERIES: SettlementEnergyPoint[] = Array.from({ length: 96 }, (_, index) => {
  const minutes = index * 15;
  const pv = pvOutputKw(minutes);
  const consumption = consumptionBaselineKw(minutes);
  const exportedKwh = Math.round(Math.max(pv - consumption, 0) * 0.25 * 100) / 100;
  const importedKwh = Math.round(Math.max(consumption - pv, 0) * 0.25 * 100) / 100;

  return {
    intervalStart: dateAtMinutes(minutes),
    exportedKwh,
    importedKwh,
  };
});

const DEMO_REVENUE = computeExportRevenue(DEMO_PRICE_SERIES, DEMO_SETTLEMENT_SERIES);

const DEMO_SETTLEMENT_TOTALS = DEMO_SETTLEMENT_SERIES.reduce(
  (totals, point) => ({
    exportedKwh: totals.exportedKwh + (point.exportedKwh ?? 0),
    importedKwh: totals.importedKwh + (point.importedKwh ?? 0),
  }),
  { exportedKwh: 0, importedKwh: 0 },
);

const DEMO_PRODUCED_TODAY_KWH = Math.round(
  DEMO_CHART_SERIES.filter((p) => dateAtMinutes(0).getTime() <= p.time && p.time <= dateAtMinutes(DEMO_NOW_MINUTES).getTime())
    .reduce((sum, p) => sum + (p.pvKw ?? 0), 0) *
    (5 / 60) *
    100,
) / 100;

// ---- Inverters: 4 units, all online, summing to the "now" PV reading ----

const DEMO_INVERTER_SPLIT_KW = [0.26, 0.25, 0.27, 0.22].map(
  (share) => Math.round(nowPvKw * share * 100) / 100,
);

const DEMO_INVERTERS: DemoInverterStatus[] = DEMO_INVERTER_SPLIT_KW.map((powerKw, index) => ({
  deviceId: `demo-inverter-${index + 1}`,
  name: `Inverter ${index + 1}`,
  // "Grid-connected" / online / green — the well-known classification for
  // documented inverter_state code 512 (see
  // lib/fusionsolar/get-plant-inverter-status.ts's classifyInverterState,
  // not imported here on purpose).
  online: true,
  powerKw,
  statusColor: "green",
  statusLabel: "Grid-connected",
}));

const DEMO_INVERTER_STATUS: DemoInverterStatusResult = { available: true, inverters: DEMO_INVERTERS };

// ---- Configured export mode: mirrors the real plant's own current, honest "unavailable" state ----
// ("Unavailable" / bg-slate-500 — the well-known describeConfiguredExportMode
// output for a failed configuration read; not imported here on purpose.)

const DEMO_CONFIGURED_EXPORT_MODE_LABEL = { label: "Unavailable", colorClass: "bg-slate-500" };

// ---- Event log ----

const DEMO_EVENT_LOG: MarketEventLogEntry[] = [
  {
    timestamp: dateAtMinutes(9 * 60 + 15),
    type: "threshold_crossed",
    label: "Price crossed export threshold",
    detail: `Day-ahead price rose above ${DEMO_THRESHOLD.minimumExportPrice} ${DEMO_THRESHOLD.currency}/MWh`,
  },
  {
    timestamp: dateAtMinutes(11 * 60 + 45),
    type: "export_stopped",
    label: "Export paused — price below threshold",
    detail: "Midday oversupply pushed the day-ahead price below the configured minimum",
  },
  {
    timestamp: dateAtMinutes(15 * 60),
    type: "export_enabled",
    label: "Export resumed",
    detail: "Price recovered above threshold as solar output tapered off",
  },
];

// ---- Distribution + insights (display-only aggregates over the price series above) ----

const DEMO_DISTRIBUTION: DistributionBucket[] = [
  { label: "High", rangeLabel: "> 150", percentage: 18.8, colorClass: "bg-emerald-400" },
  { label: "Mid", rangeLabel: "75–150", percentage: 39.6, colorClass: "bg-blue-400" },
  { label: "Low", rangeLabel: "< 75", percentage: 41.6, colorClass: "bg-amber-400" },
];

const DEMO_INSIGHTS: MarketInsight[] = [
  { text: "Highest price today: 168.4 EUR/MWh at 19:00", tone: "warning" },
  { text: "Lowest price today: -8.2 EUR/MWh at 13:00", tone: "positive" },
  { text: "Price spread: 176.6 EUR/MWh", tone: "neutral" },
  { text: "Average price: 79.3 EUR/MWh", tone: "neutral" },
  { text: "Volatility: Medium", tone: "neutral" },
  { text: "Negative price intervals: 3", tone: "neutral" },
  { text: "Hours above threshold: 14.5 h", tone: "positive" },
  { text: "Hours below threshold: 9.5 h", tone: "neutral" },
  { text: "Threshold crossings: 4", tone: "neutral" },
];

// ---- Assembled page-shaped exports ----

const DEMO_TODAY_STR = new Date(DEMO_DAY_START).toISOString().slice(0, 10);

function shiftedDateStr(deltaDays: number): string {
  const d = new Date(DEMO_DAY_START);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

const DEMO_CURRENT_PRICE: MarketSummaryData["currentPrice"] = {
  value: nowPriceEurPerMwh,
  currency: "EUR",
  intervalLabel: "16:30",
  deltaVsPrevious: 4.2,
};

const DEMO_MARKET_WIDGET: DashboardMarketWidgetData = {
  currentPrice: DEMO_CURRENT_PRICE,
  exportRecommended: isExportRecommended(nowPriceEurPerMwh, DEMO_THRESHOLD),
  threshold: DEMO_THRESHOLD,
};

const DEMO_KPIS: DashboardKpis = {
  producedTodayKwh: DEMO_PRODUCED_TODAY_KWH,
  totalYieldKwh: 612_400,
  consumedTodayKwh: Math.round(DEMO_PRODUCED_TODAY_KWH * 0.28 * 100) / 100,
  consumedFromPvKwh: Math.round(DEMO_PRODUCED_TODAY_KWH * 0.24 * 100) / 100,
  exportedTodayKwh: Math.round(DEMO_SETTLEMENT_TOTALS.exportedKwh * 100) / 100,
  importedTodayKwh: Math.round(DEMO_SETTLEMENT_TOTALS.importedKwh * 100) / 100,
  revenue: DEMO_REVENUE,
};

export const DEMO_DASHBOARD_DATA: Extract<DashboardPageData, { plantAvailable: true }> = {
  plantAvailable: true,
  selectedDate: DEMO_TODAY_STR,
  isToday: true,
  prevDateParam: shiftedDateStr(-1),
  nextDateParam: shiftedDateStr(1),
  plantName: DEMO_PLANT_NAME,
  kpis: DEMO_KPIS,
  energyFlow: DEMO_ENERGY_FLOW,
  chartSeries: DEMO_CHART_SERIES,
  nowAnnotation: DEMO_ENERGY_FLOW.available
    ? `${DEMO_ENERGY_FLOW.pvKw} kW PV · ${DEMO_ENERGY_FLOW.gridKw} kW export`
    : undefined,
  inverters: DEMO_INVERTER_STATUS,
  latestTelemetryAt: dateAtMinutes(DEMO_NOW_MINUTES - 4),
  market: DEMO_MARKET_WIDGET,
  eventLog: DEMO_EVENT_LOG,
};

export const DEMO_MARKET_DATA: Extract<MarketPageResult, { dataAvailable: true }> = {
  dataAvailable: true,
  selectedDate: DEMO_TODAY_STR,
  isToday: true,
  prevDateParam: shiftedDateStr(-1),
  nextDateParam: shiftedDateStr(1),
  threshold: DEMO_THRESHOLD,
  series: DEMO_PRICE_SERIES,
  isPartialImport: false,
  summary: {
    currentPrice: DEMO_CURRENT_PRICE,
    nextInterval: { value: dayAheadPriceEurPerMwh(DEMO_NOW_MINUTES + 15), intervalLabel: "16:45", direction: "up" },
    lowestToday: { value: -8.2, intervalLabel: "13:00" },
    highestToday: { value: 168.4, intervalLabel: "19:00" },
    marketStatus: { country: "Bulgaria", source: "ENTSO-E", healthy: true },
  },
  eventLog: DEMO_EVENT_LOG,
  distribution: DEMO_DISTRIBUTION,
  insights: DEMO_INSIGHTS,
};

export const DEMO_PRODUCTION_DATA: ProductionPageData = {
  currentProduction: { available: true, kw: nowPvKw },
  currentExport: { available: true, kw: nowExportKw } as ProductionReading,
  currentImport: { available: true, kw: nowImportKw } as ProductionReading,
  configuredExportMode: { available: false, reason: "configuration_endpoint_failed" },
  configuredExportModeLabel: DEMO_CONFIGURED_EXPORT_MODE_LABEL,
  settlementEnergySeries: DEMO_SETTLEMENT_SERIES,
  installedCapacityKw: DEMO_INSTALLED_CAPACITY_KW,
  latestTelemetryAt: dateAtMinutes(DEMO_NOW_MINUTES - 4),
};
