/**
 * Dashboard page's data orchestration — the operational-monitoring
 * counterpart to `market/market-data.ts` / `market/production-data.ts`
 * (Final Dashboard UX Refinement milestone). Market = financial decisions;
 * Dashboard = live plant operation. Every number here is either read
 * directly or composed from the exact same functions Market already uses
 * (`getMarketPageData`, `getProductionPageData`, `computeExportRevenue`,
 * `energy-metrics.ts`'s building blocks) — nothing here reimplements a
 * telemetry or revenue calculation; see each field's doc comment for its
 * real source.
 *
 * Single-plant, matching `production-data.ts`'s own assumption (the MVP
 * scope, per docs/CLIENT_REQUIREMENTS.md, is one plant) — the same
 * plant-lookup filter is reused here rather than a second implementation.
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
import {
  computeEnergyMetricsFromSeries,
  getPlantTelemetrySeries,
  sumSettlementEnergy,
  type PlantTelemetrySeriesPoint,
} from "@/lib/telemetry/energy-metrics";

import { getMarketPageData } from "@/app/(platform)/market/market-data";
import { getProductionPageData, type ProductionReading } from "@/app/(platform)/market/production-data";

export type DashboardKpis = {
  producedTodayKwh: number | null;
  consumedTodayKwh: number | null;
  exportedTodayKwh: number | null;
  importedTodayKwh: number | null;
  revenue: RevenueSummary;
};

/**
 * The three-node PV -> Home -> Grid flow. Direction is derived purely from
 * the real current meter reading (`getPlantCurrentPowerStatus`, Category A
 * — a live Huawei read), never inferred from configuration. `currentExport`/
 * `currentImport` are already mutually exclusive at the source (one is
 * always exactly `0` — see `get-plant-power-status.ts`), so "idle" is
 * exactly the case where both are `0`, not an invented tolerance band.
 */
export type EnergyFlowState =
  | { available: false }
  | {
      available: true;
      pvKw: number;
      consumptionKw: number;
      direction: "importing" | "exporting" | "idle";
      gridKw: number;
    };

/** One point on the Live Energy Chart — `null` fields mean no real sample at that exact timestamp, never fabricated/interpolated. */
export type EnergyFlowPoint = {
  time: number;
  pvKw: number | null;
  consumptionKw: number | null;
  gridImportKw: number | null;
  gridExportKw: number | null;
};

/**
 * No weather data provider exists anywhere in this codebase today (no API
 * integration, no credential, no Prisma model) — confirmed by search, not
 * assumed. Per this app's established convention (never fabricate a value
 * when a real source is unavailable — see `ProductionReading`,
 * `MarketPriceStatus`, etc.), the widget is built and styled but every
 * field reports `available: false` rather than inventing a weather API
 * call or a placeholder number. Wiring a real provider is explicit future
 * work, not attempted here per this milestone's "no backend changes
 * unless absolutely required by the UI" constraint.
 */
export type WeatherData = { available: false };

/**
 * `currentProductionKw` is real (the same live reading the energy-flow
 * diagram uses). No production-forecasting model exists in this codebase —
 * confirmed by search, not assumed — so forecast production, forecast
 * completion, and expected end-of-day production are honestly `null`
 * rather than fabricated. Building a real forecast model is explicit
 * future work.
 */
export type GlidepathData = {
  currentProduction: ProductionReading;
  forecastProductionKw: number | null;
  forecastCompletionPercent: number | null;
  expectedEndOfDayKwh: number | null;
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
      inverters: InverterStatusResult;
      weather: WeatherData;
      glidepath: GlidepathData;
      latestTelemetryAt: Date | null;
      market: DashboardMarketWidgetData;
      eventLog: MarketEventLogEntry[];
    };

/**
 * Consumption can never be physically negative, but deriving it as
 * `production + import - export` can produce a negative artifact for this
 * plant: its real-time inverter power reading is already documented
 * elsewhere (`energy-metrics.ts`'s `peakExport` doc comment) as reading
 * near-zero even during genuine substantial export, since it's a
 * different measurement point than the meter. Clamping to zero here is
 * the same established pattern already used throughout this codebase for
 * exactly this kind of sign artifact (`exportKw = max(meterKw, 0)`,
 * `importKw = max(-meterKw, 0)`), not a fabrication - the underlying
 * PV/grid readings themselves are shown unclamped and unmodified.
 */
function toEnergyFlowPoint(point: PlantTelemetrySeriesPoint): EnergyFlowPoint {
  const consumptionKw =
    point.productionKw !== null && point.exportKw !== null && point.importKw !== null
      ? Math.max(0, Math.round((point.productionKw + point.importKw - point.exportKw) * 100) / 100)
      : null;

  return {
    time: point.timestamp.getTime(),
    pvKw: point.productionKw,
    consumptionKw,
    gridImportKw: point.importKw,
    gridExportKw: point.exportKw,
  };
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

  const pvKw = production.currentProduction.kw;
  const exportKw = production.currentExport.kw;
  const importKw = production.currentImport.kw;

  if (importKw > 0) {
    return {
      available: true,
      pvKw,
      // Never negative in reality - see toEnergyFlowPoint's doc comment
      // for why the clamp is needed (this plant's real-time inverter
      // reading can under-report versus the meter).
      consumptionKw: Math.max(0, Math.round((pvKw + importKw) * 100) / 100),
      direction: "importing",
      gridKw: importKw,
    };
  }

  if (exportKw > 0) {
    return {
      available: true,
      pvKw,
      consumptionKw: Math.max(0, Math.round((pvKw - exportKw) * 100) / 100),
      direction: "exporting",
      gridKw: exportKw,
    };
  }

  return {
    available: true,
    pvKw,
    consumptionKw: pvKw,
    direction: "idle",
    gridKw: 0,
  };
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
    select: { id: true, name: true, timezone: true },
  });

  if (!plant) {
    return { plantAvailable: false };
  }

  const { start: dayStart } = localDayBoundsUtc(new Date(), plant.timezone);
  const now = new Date();

  // Reused wholesale from Market's own orchestration — never a second
  // implementation of price fetching, export-revenue math, or real-time
  // FusionSolar reads. See each module's own doc comment.
  const [marketData, production, chartSeriesRaw, connection] = await Promise.all([
    getMarketPageData({ selectedDateParam: undefined, automationSettings }),
    getProductionPageData(organizationId, undefined),
    getPlantTelemetrySeries(plant.id, dayStart, now),
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

  // Same two building blocks `computePlantEnergyMetrics` itself composes
  // (energy-metrics.ts) — reused directly against data already fetched
  // above instead of issuing a second, redundant DeviceTelemetry query for
  // the same [dayStart, now) window.
  const productionMetrics = computeEnergyMetricsFromSeries(chartSeriesRaw);
  const settlementTotals = sumSettlementEnergy(production.settlementEnergySeries);

  const kpis: DashboardKpis = {
    producedTodayKwh: productionMetrics.available ? productionMetrics.producedKwh : null,
    exportedTodayKwh: settlementTotals.available ? settlementTotals.exportedKwh : null,
    importedTodayKwh: settlementTotals.available ? settlementTotals.importedKwh : null,
    consumedTodayKwh:
      productionMetrics.available && settlementTotals.available
        ? Math.round(
            (productionMetrics.producedKwh +
              settlementTotals.importedKwh -
              settlementTotals.exportedKwh) *
              100,
          ) / 100
        : null,
    revenue,
  };

  const energyFlow = buildEnergyFlow(production);
  const chartSeries = chartSeriesRaw.map(toEnergyFlowPoint);

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

  const glidepath: GlidepathData = {
    currentProduction: production.currentProduction,
    forecastProductionKw: null,
    forecastCompletionPercent: null,
    expectedEndOfDayKwh: null,
  };

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
    inverters,
    weather: { available: false },
    glidepath,
    latestTelemetryAt: production.latestTelemetryAt,
    market: { currentPrice, exportRecommended, threshold },
    eventLog: marketData.dataAvailable ? marketData.eventLog : [],
  };
}
