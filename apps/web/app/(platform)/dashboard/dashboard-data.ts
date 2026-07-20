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
 */

import type { ExportThresholdConfig } from "@/lib/automation/export-threshold-config";
import { isExportRecommended } from "@/lib/automation/export-threshold-config";
import {
  getPlantInverterStatuses,
  type InverterStatusResult,
} from "@/lib/fusionsolar/get-plant-inverter-status";
import type { MarketEventLogEntry, MarketSummaryData } from "@/app/(platform)/market/market-data";
import { computeExportRevenue, type RevenueSummary } from "@/lib/market-price/revenue";
import { localDayBoundsUtc } from "@/lib/market-price/timezone";
import { prisma } from "@/lib/prisma";
import { deriveEnergyFlow, type EnergyFlowResult } from "@/lib/telemetry/energy-flow";
import {
  getPlantTelemetrySeries,
  sumSettlementEnergy,
  type PlantTelemetrySeriesPoint,
} from "@/lib/telemetry/energy-metrics";
import { getPlantDailyKpi } from "@/lib/telemetry/plant-daily-kpi";

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
  consumedTodayKwh: number | null;
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

export type DashboardPageData =
  | { plantAvailable: false }
  | {
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
    };

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

export async function getDashboardPageData(
  organizationId: string,
  automationSettings: {
    minimumExportPrice: { toString(): string };
    currency: string;
  } | null,
): Promise<DashboardPageData> {
  const plant = await prisma.plant.findFirst({
    where: {
      organizationId,
      vendor: "Huawei",
      stationCode: { not: null },
      plantCode: { not: null },
    },
    select: { id: true, name: true },
  });

  if (!plant) {
    return { plantAvailable: false };
  }

  const now = new Date();
  const { start: dayStart, end: dayEnd } = localDayBoundsUtc(now, BULGARIA_TIMEZONE);

  // Reused wholesale from Market's own orchestration — never a second
  // implementation of price fetching, export-revenue math, or real-time
  // FusionSolar reads. See each module's own doc comment.
  const [marketData, production, chartSeriesRaw, dailyKpi, connection] = await Promise.all([
    getMarketPageData({ selectedDateParam: undefined, automationSettings }),
    getProductionPageData(organizationId, undefined),
    getPlantTelemetrySeries(plant.id, dayStart, now),
    getPlantDailyKpi(plant.id, dayStart),
    prisma.fusionSolarConnection.findUnique({
      where: {
        organizationId_provider: { organizationId, provider: "HuaweiFusionSolar" },
      },
      select: {
        id: true,
        accessToken: true,
        refreshToken: true,
        tokenType: true,
        scope: true,
        expiresAt: true,
      },
    }),
  ]);

  const revenue: RevenueSummary = marketData.dataAvailable
    ? computeExportRevenue(marketData.series, production.settlementEnergySeries)
    : { available: false };

  // Exported/Imported Today: unchanged, still the meter's cumulative
  // counters (energy-metrics.ts) — reused directly against data already
  // fetched above instead of issuing a second, redundant DeviceTelemetry
  // query for the same [dayStart, now) window.
  const settlementTotals = sumSettlementEnergy(production.settlementEnergySeries);

  const kpis: DashboardKpis = {
    producedTodayKwh: dailyKpi.available ? dailyKpi.producedKwh : null,
    consumedTodayKwh: dailyKpi.available ? dailyKpi.consumedKwh : null,
    exportedTodayKwh: settlementTotals.available ? settlementTotals.exportedKwh : null,
    importedTodayKwh: settlementTotals.available ? settlementTotals.importedKwh : null,
    revenue,
  };

  const energyFlow = buildEnergyFlow(production);
  const chartSeries = buildFullDayChartSeries(dayStart, dayEnd, chartSeriesRaw);
  const nowAnnotation = buildNowAnnotation(energyFlow);

  let inverters: InverterStatusResult = {
    available: false,
    reason: "no_inverter_devices",
  };

  if (connection) {
    const inverterDevices = await prisma.device.findMany({
      where: { plantId: plant.id, devTypeId: 1 },
      select: { id: true, devName: true, huaweiDeviceId: true },
    });

    inverters = await getPlantInverterStatuses(connection, inverterDevices);
  }

  const currentPrice = marketData.dataAvailable ? marketData.summary.currentPrice : null;
  const threshold = marketData.threshold;
  const exportRecommended =
    currentPrice !== null ? isExportRecommended(currentPrice.value, threshold) : null;

  return {
    plantAvailable: true,
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
