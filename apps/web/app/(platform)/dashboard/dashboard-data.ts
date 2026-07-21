/**
 * Dashboard page's data orchestration — the operational-monitoring
 * counterpart to `market/market-data.ts` / `market/production-data.ts`
 * (Design-System Consistency milestone, building on the Final Dashboard
 * UX Refinement milestone). Market = financial decisions; Dashboard =
 * live plant operation. Every number here is either read directly or
 * composed from the exact same functions Market already uses
 * (`getMarketPageData`, `getProductionPageData`, `computeExportRevenue`,
 * `energy-metrics.ts`'s building blocks) — nothing here reimplements a
 * telemetry or revenue calculation; see each field's doc comment for its
 * real source.
 *
 * Single-plant, matching `production-data.ts`'s own assumption (the MVP
 * scope, per docs/CLIENT_REQUIREMENTS.md, is one plant) — the same
 * plant-lookup filter is reused here rather than a second implementation.
 *
 * ## One telemetry snapshot, one day boundary (Design-System Consistency
 * milestone's data-correctness audit)
 *
 * `BULGARIA_TIMEZONE` here matches `market-data.ts`/`production-data.ts`'s
 * own hardcoded "Europe/Sofia" exactly, rather than reading `Plant.timezone`
 * (what this module did before this audit). Both already happen to be
 * "Europe/Sofia" for the one real plant today, but reading a
 * per-plant-configurable field here while every sibling module hardcodes
 * the same zone was a latent parallel-implementation risk this audit
 * closes: `dayStart` must be identical across `chartSeries` (this module)
 * and `settlementEnergySeries` (`production-data.ts`) for the chart to show
 * the same day Market shows and for Exported/Imported to add up
 * consistently. The System Overview / Live Energy chart (real-time,
 * unchanged) derive from `getPlantTelemetrySeries` and
 * `production.settlementEnergySeries` over the identical `[dayStart, now)`
 * window; nothing recomputes a third, independent version of "today."
 *
 * ## Produced/Consumed Today (Telemetry Architecture Finalization
 * milestone, ADR-010)
 *
 * `producedTodayKwh`/`consumedTodayKwh` no longer come from integrating
 * this page's own power series — that reconstruction was found to disagree
 * with Huawei's own daily counters by ~28% (docs/research/energy-data-audit.md).
 * They now read `PlantDailyKpi` (`lib/telemetry/plant-daily-kpi.ts`'s
 * `getPlantDailyKpi`), the table a Scaleway-scheduled ingestion cycle
 * writes Huawei's `day_power`/`day_use_energy` counters into — this page
 * never calls FusionSolar for these two figures. Exported/Imported Today
 * are unaffected: they still come from the meter's cumulative counters via
 * `sumSettlementEnergy`, already within tolerance of Huawei and explicitly
 * kept as-is.
 *
 * ## Date navigation (Dashboard visual polish milestone)
 *
 * `getDashboardPageData` now accepts `selectedDateParam`, mirroring
 * `getMarketPageData`/`getProductionPageData`'s own pattern exactly —
 * `page.tsx` reads it from the `?date=` query param and passes it straight
 * through to those two functions unchanged, so any day they already
 * support (they needed no changes at all) is now viewable on Dashboard too.
 * Category A fields (inverter status, the System Overview diagram, the
 * chart's NOW marker) are only ever fetched/shown for `today` — "current
 * state" has no meaning for a day that already happened — exactly the
 * same convention `production-data.ts` already established for its own
 * Category A fields.
 *
 * ## Database-First Telemetry Architecture milestone
 *
 * This module never imports `lib/fusionsolar/telemetry-sync-service.ts`
 * or any live Huawei-calling function. Inverter status now comes from
 * `DeviceTelemetry`'s newest row per inverter device instead of a live
 * `getDevRealKpi` call — the same `classifyInverterState` enumeration
 * (`get-plant-inverter-status.ts`, exported and reused, not duplicated)
 * decodes the stored `inverterState` value exactly as it decoded the live
 * one. `energyFlow`/`currentProduction`/`currentExport`/`currentImport`
 * were already sourced from `production-data.ts`, which underwent the
 * same migration — see that module's doc comment.
 *
 * ## Repository-Layer Deduplication milestone
 *
 * Plant/connection resolution moved to `lib/telemetry/plant-context.ts`'s
 * `resolvePlantContext`, called exactly once here (previously: this
 * module's own `Plant` lookup, `production-data.ts`'s own separate
 * `Plant` lookup, and one more `Plant`+`FusionSolarConnection` pair per
 * repository call needing a freshness check — measured at 3 separate
 * `Plant` queries and 3 separate `FusionSolarConnection` queries for one
 * Dashboard render). The resolved context is passed into
 * `getProductionPageData` as a preload, so Market's own internal
 * resolution is skipped when called from here. Inverter telemetry is
 * fetched exactly once (previously: once inside `getProductionPageData`
 * for `currentProduction`, and again by this module for the Inverters
 * card — the same 4 `DeviceTelemetry` rows, twice) and reused for both.
 */

import type { ExportThresholdConfig } from "@/lib/automation/export-threshold-config";
import { isExportRecommended } from "@/lib/automation/export-threshold-config";
import {
  classifyInverterState,
  type InverterStatus,
  type InverterStatusResult,
} from "@/lib/fusionsolar/get-plant-inverter-status";
import type { MarketEventLogEntry, MarketSummaryData } from "@/app/(platform)/market/market-data";
import { computeExportRevenue, type RevenueSummary } from "@/lib/market-price/revenue";
import { formatDateInZone, localDayBoundsUtc } from "@/lib/market-price/timezone";
import { prisma } from "@/lib/prisma";
import { deriveEnergyFlow, type EnergyFlowResult } from "@/lib/telemetry/energy-flow";
import {
  getPlantTelemetrySeries,
  sumSettlementEnergy,
  type PlantTelemetrySeriesPoint,
} from "@/lib/telemetry/energy-metrics";
import {
  getLatestInverterTelemetryForDevices,
  INVERTER_DEV_TYPE_ID,
} from "@/lib/telemetry/queries";
import { getPlantDailyKpi } from "@/lib/telemetry/plant-daily-kpi";
import { resolvePlantContext } from "@/lib/telemetry/plant-context";

import { getMarketPageData } from "@/app/(platform)/market/market-data";
import { getProductionPageData, type ProductionReading } from "@/app/(platform)/market/production-data";

/** Same Sofia local-day convention `market-data.ts` / `production-data.ts` use — see this module's top doc comment for why this is hardcoded here too, not read from `Plant.timezone`. */
const BULGARIA_TIMEZONE = "Europe/Sofia";

/**
 * `DeviceTelemetry`'s confirmed real sample grid (ADR-007,
 * docs/research/telemetry-platform-foundation.md). Duplicated as a literal
 * for the same reason `MarketPriceChart.tsx`'s `SETTLEMENT_INTERVAL_MINUTES`
 * is: this fact is already established elsewhere and extremely unlikely to
 * drift, and importing the real constant would pull server-only Prisma
 * code into a module whose output also feeds a "use client" chart.
 */
const TELEMETRY_GRID_MINUTES = 5;

export type DashboardKpis = {
  producedTodayKwh: number | null;
  /** Lifetime PV yield (Huawei `total_power`) — see `getPlantDailyKpi`'s doc comment. `null` only when the field isn't present, never fabricated. */
  totalYieldKwh: number | null;
  consumedTodayKwh: number | null;
  /**
   * Self-consumption: the portion of today's PV yield that never left the
   * site (`producedTodayKwh - exportedTodayKwh`) — a plain energy-balance
   * identity over two values already computed above, not a new
   * measurement or Huawei field. `null` whenever either input is
   * unavailable, or when the subtraction would go negative (a genuine
   * disagreement between the two independent Huawei-sourced counters) —
   * never clamped to zero.
   */
  consumedFromPvKwh: number | null;
  exportedTodayKwh: number | null;
  importedTodayKwh: number | null;
  revenue: RevenueSummary;
};

/**
 * The three-node PV -> Home -> Grid flow. See
 * `lib/telemetry/energy-flow.ts` for the one documented domain calculation
 * this is derived from — this page never modifies, clamps, or floors a
 * measured value itself.
 */
export type EnergyFlowState = EnergyFlowResult;

/** One point on the Live Energy Chart — `null` fields mean no real sample at that exact timestamp (a gap, or a not-yet-happened future time), never fabricated/interpolated. */
export type EnergyFlowPoint = {
  time: number;
  pvKw: number | null;
  consumptionKw: number | null;
  gridImportKw: number | null;
  gridExportKw: number | null;
};

export type DashboardMarketWidgetData = {
  currentPrice: MarketSummaryData["currentPrice"];
  exportRecommended: boolean | null;
  threshold: ExportThresholdConfig;
};

/**
 * Date-toolbar state (Dashboard visual polish milestone) — same shape and
 * meaning as `market-data.ts`'s `MarketToolbarState`, computed the same way
 * (duplicated intentionally, matching `production-data.ts`'s own documented
 * precedent for this exact pattern, rather than sharing a new utility
 * module) so Dashboard can render the same `MarketToolbar` component with
 * real, working day navigation.
 */
export type DashboardToolbarState = {
  selectedDate: string;
  isToday: boolean;
  prevDateParam: string;
  nextDateParam: string;
};

export type DashboardPageData =
  | ({ plantAvailable: false } & DashboardToolbarState)
  | ({
      plantAvailable: true;
      plantName: string;
      kpis: DashboardKpis;
      energyFlow: EnergyFlowState;
      chartSeries: EnergyFlowPoint[];
      /** Real-time reading for the chart's NOW marker — same values `energyFlow` uses, never a second live read. */
      nowAnnotation: string | undefined;
      inverters: InverterStatusResult;
      latestTelemetryAt: Date | null;
      market: DashboardMarketWidgetData;
      eventLog: MarketEventLogEntry[];
    } & DashboardToolbarState);

/**
 * One point on the chart, via the same domain function
 * (`deriveEnergyFlow`) the live snapshot uses. `consumptionKw` is `null`
 * both for a genuine data gap (handled before this is called) and for a
 * measurement inconsistency (`consumption.consistent === false`) — either
 * way, "no honest number to show," never a fabricated one. `pvKw`/grid
 * values are always the real measured readings for that timestamp,
 * unmodified, even when consumption can't be derived.
 */
function toEnergyFlowPoint(point: PlantTelemetrySeriesPoint): EnergyFlowPoint {
  if (point.productionKw === null || point.exportKw === null || point.importKw === null) {
    return { time: point.timestamp.getTime(), pvKw: null, consumptionKw: null, gridImportKw: null, gridExportKw: null };
  }

  const flow = deriveEnergyFlow(point.productionKw, point.exportKw, point.importKw);

  if (!flow.available) {
    return { time: point.timestamp.getTime(), pvKw: null, consumptionKw: null, gridImportKw: null, gridExportKw: null };
  }

  return {
    time: point.timestamp.getTime(),
    pvKw: flow.pvKw,
    consumptionKw: flow.consumption.consistent ? flow.consumption.kw : null,
    gridImportKw: flow.direction === "importing" ? flow.gridKw : 0,
    gridExportKw: flow.direction === "exporting" ? flow.gridKw : 0,
  };
}

/**
 * A full 00:00-24:00 Europe/Sofia grid at the real telemetry resolution -
 * exactly like Market's own price series, which always spans the whole
 * calendar day (day-ahead prices are known for the full day in advance),
 * never just "up to now". Telemetry has no equivalent of "known in
 * advance", so every slot at/after the last real sample is `null` (not
 * yet happened / no data), never fabricated or interpolated - this is a
 * presentational grid built over the exact same query result
 * `computeEnergyMetricsFromSeries`/KPIs already use, not a second query.
 */
function buildFullDayChartSeries(
  dayStart: Date,
  dayEnd: Date,
  points: PlantTelemetrySeriesPoint[],
): EnergyFlowPoint[] {
  const byTime = new Map(points.map((point) => [point.timestamp.getTime(), point]));
  const stepMs = TELEMETRY_GRID_MINUTES * 60 * 1000;
  const grid: EnergyFlowPoint[] = [];

  for (let t = dayStart.getTime(); t < dayEnd.getTime(); t += stepMs) {
    const point = byTime.get(t);

    grid.push(
      point
        ? toEnergyFlowPoint(point)
        : { time: t, pvKw: null, consumptionKw: null, gridImportKw: null, gridExportKw: null },
    );
  }

  return grid;
}

function buildEnergyFlow(production: {
  currentProduction: ProductionReading;
  currentExport: ProductionReading;
  currentImport: ProductionReading;
}): EnergyFlowState {
  if (
    !production.currentProduction.available ||
    !production.currentExport.available ||
    !production.currentImport.available
  ) {
    return { available: false };
  }

  return deriveEnergyFlow(
    production.currentProduction.kw,
    production.currentExport.kw,
    production.currentImport.kw,
  );
}

/** Uses `energyFlow`'s real measured `pvKw`/`gridKw` (the same values the System Overview diagram shows) so the chart's NOW marker never contradicts it. */
function buildNowAnnotation(energyFlow: EnergyFlowState): string | undefined {
  if (!energyFlow.available) {
    return undefined;
  }

  return `${energyFlow.pvKw} kW PV · ${energyFlow.gridKw} kW ${energyFlow.direction === "importing" ? "import" : "export"}`;
}

/** Identical logic to `market-data.ts`'s own (private) `shiftDateString` — duplicated, not imported, matching `production-data.ts`'s documented precedent for this exact date-handling pattern. */
function shiftDateString(dateStr: string, deltaDays: number): string {
  const parts = dateStr.split("-").map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;

  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + deltaDays);

  return date.toISOString().slice(0, 10);
}

function isValidDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function getDashboardPageData(
  organizationId: string,
  automationSettings: {
    minimumExportPrice: { toString(): string };
    currency: string;
  } | null,
  selectedDateParam: string | undefined,
): Promise<DashboardPageData> {
  // Same resolution as `market-data.ts`'s own `getMarketPageData` — see
  // `DashboardToolbarState`'s doc comment for why this is duplicated here
  // rather than imported.
  const todayDateStr = formatDateInZone(new Date(), BULGARIA_TIMEZONE);
  const selectedDate =
    selectedDateParam && isValidDateString(selectedDateParam) ? selectedDateParam : todayDateStr;
  const isToday = selectedDate === todayDateStr;
  const toolbarState: DashboardToolbarState = {
    selectedDate,
    isToday,
    prevDateParam: shiftDateString(selectedDate, -1),
    nextDateParam: shiftDateString(selectedDate, 1),
  };

  const context = await resolvePlantContext(organizationId);

  if (!context) {
    return { plantAvailable: false, ...toolbarState };
  }

  const { plant } = context;

  const referenceInstant = new Date(`${selectedDate}T12:00:00Z`);
  const now = new Date();
  const { start: dayStart, end: dayEnd } = localDayBoundsUtc(referenceInstant, BULGARIA_TIMEZONE);
  // Never show future data for "today" (the day is still in progress); a
  // past day already fully happened, so its whole day is real data — same
  // convention as `production-data.ts`'s own `seriesEnd`.
  const seriesEnd = isToday ? now : dayEnd;

  // Category A (inverter status) only ever describes "right now" — same
  // convention `production-data.ts` already uses for its own Category A
  // fields, so a historical day never shows current state. Fetched once,
  // here, and reused both for this page's own Inverters card (below) and
  // as a preload passed into `getProductionPageData` — that function
  // previously re-fetched the exact same 4 `DeviceTelemetry` rows itself.
  const inverterDevices = isToday
    ? await prisma.device.findMany({
        where: { plantId: plant.id, devTypeId: INVERTER_DEV_TYPE_ID },
        select: { id: true, devName: true },
      })
    : [];

  const inverterTelemetry = isToday
    ? await getLatestInverterTelemetryForDevices(inverterDevices.map((device) => device.id))
    : [];

  // Reused wholesale from Market's own orchestration — never a second
  // implementation of price fetching, export-revenue math, or real-time
  // FusionSolar reads. See each module's own doc comment. Passing the real
  // `selectedDateParam` through (instead of always `undefined`) is what
  // makes Dashboard capable of showing any day Market/Production already
  // support — neither function needed a single change. `context`/
  // `inverterTelemetry` preloaded above so `getProductionPageData` skips
  // its own equivalent (otherwise redundant) resolution and fetch.
  const [marketData, production, chartSeriesRaw, dailyKpi] = await Promise.all([
    getMarketPageData({ selectedDateParam, automationSettings }),
    getProductionPageData(organizationId, selectedDateParam, { context, inverterTelemetry }),
    getPlantTelemetrySeries(plant.id, dayStart, seriesEnd),
    getPlantDailyKpi(plant.id, dayStart),
  ]);

  const revenue: RevenueSummary = marketData.dataAvailable
    ? computeExportRevenue(marketData.series, production.settlementEnergySeries)
    : { available: false };

  // Exported/Imported Today: unchanged, still the meter's cumulative
  // counters (energy-metrics.ts) — reused directly against data already
  // fetched above instead of issuing a second, redundant DeviceTelemetry
  // query for the same [dayStart, now) window.
  const settlementTotals = sumSettlementEnergy(production.settlementEnergySeries);

  const producedTodayKwh = dailyKpi.available ? dailyKpi.producedKwh : null;
  const exportedTodayKwh = settlementTotals.available ? settlementTotals.exportedKwh : null;
  const selfConsumptionKwh =
    producedTodayKwh !== null && exportedTodayKwh !== null && producedTodayKwh >= exportedTodayKwh
      ? Math.round((producedTodayKwh - exportedTodayKwh) * 100) / 100
      : null;

  const kpis: DashboardKpis = {
    producedTodayKwh,
    totalYieldKwh: dailyKpi.available ? dailyKpi.totalYieldKwh : null,
    consumedTodayKwh: dailyKpi.available ? dailyKpi.consumedKwh : null,
    consumedFromPvKwh: selfConsumptionKwh,
    exportedTodayKwh,
    importedTodayKwh: settlementTotals.available ? settlementTotals.importedKwh : null,
    revenue,
  };

  const energyFlow = buildEnergyFlow(production);
  const chartSeries = buildFullDayChartSeries(dayStart, dayEnd, chartSeriesRaw);
  const nowAnnotation = buildNowAnnotation(energyFlow);

// "Current state" has no meaning for a day that already happened
  // (`inverterDevices` is deliberately `[]` whenever `!isToday`, see
  // above) — `"historical_day"` (added to `InverterStatusResult` for
  // exactly this, Dashboard UI final polish milestone) lets
  // `InvertersCard` show accurate wording instead of misreporting "no
  // inverter devices configured" for a historical view.
  let inverters: InverterStatusResult = {
    available: false,
    reason: isToday ? "no_inverter_devices" : "historical_day",
  };

  if (isToday && inverterDevices.length > 0) {
    // Reuses the `inverterTelemetry` already fetched above (also passed
    // to `getProductionPageData` as a preload) — no second query for the
    // same rows.
    const telemetryByDeviceId = new Map(
      inverterTelemetry.map((row) => [row.deviceId, row] as const),
    );

    const statuses: InverterStatus[] = inverterDevices.map((device) => {
      const row = telemetryByDeviceId.get(device.id);
      const rawState = row?.inverterState ?? null;
      const classification = classifyInverterState(rawState);

      return {
        deviceId: device.id,
        name: device.devName,
        online: classification.online,
        powerKw: row?.activePower ? row.activePower.toNumber() : null,
        statusColor: classification.color,
        statusLabel: classification.label,
      };
    });

    inverters = { available: true, inverters: statuses };
  }

  const currentPrice = marketData.dataAvailable ? marketData.summary.currentPrice : null;
  const threshold = marketData.threshold;
  const exportRecommended =
    currentPrice !== null ? isExportRecommended(currentPrice.value, threshold) : null;

  return {
    plantAvailable: true,
    ...toolbarState,
    plantName: plant.name,
    kpis,
    energyFlow,
    chartSeries,
    nowAnnotation,
    inverters,
    latestTelemetryAt: production.latestTelemetryAt,
    market: { currentPrice, exportRecommended, threshold },
    eventLog: marketData.dataAvailable ? marketData.eventLog : [],
  };
}
