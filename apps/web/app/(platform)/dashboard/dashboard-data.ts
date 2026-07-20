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
 * and `settlementEnergySeries` (`production-data.ts`) for Produced/
 * Consumed/Exported/Imported to add up consistently and for the chart to
 * show the same day Market shows. Produced/Consumed/Exported/Imported,
 * the chart, and Revenue are now all derived from exactly two queries -
 * `getPlantTelemetrySeries` and `production.settlementEnergySeries` - over
 * the identical `[dayStart, now)` window; nothing recomputes a third,
 * independent version of "today."
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
 * The three-node PV -> Home -> Grid flow, exactly two possible states
 * (Design-System Consistency milestone) - never a third "idle" state.
 * Direction is derived purely from the real current meter reading
 * (`getPlantCurrentPowerStatus`, Category A - a live Huawei read), never
 * inferred from configuration:
 *
 * - Case A (`exporting`): PV >= Consumption. Grid displays exported power.
 * - Case B (`importing`): Consumption > PV. Grid displays imported power.
 *
 * `currentExport`/`currentImport` are already mutually exclusive at the
 * source (one is always exactly `0` - see `get-plant-power-status.ts`), so
 * checking `importKw > 0` alone is a complete, exhaustive test - the `else`
 * branch is exactly "PV >= Consumption" (covers both real export and the
 * exact-zero-net tie), matching Case A's own "`>=`" definition.
 */
export type EnergyFlowState =
  | { available: false }
  | {
      available: true;
      pvKw: number;
      consumptionKw: number;
      direction: "importing" | "exporting";
      gridKw: number;
    };

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
 * Enforces exact energy conservation - exactly one of these two equations
 * always holds, never an inconsistent combination of the three nodes:
 *
 * - Case A (exporting): `PV = Home + Export`
 * - Case B (importing): `Home = PV + Import`
 *
 * There is no independent "Home" meter anywhere in this integration -
 * consumption has always been a derived quantity (see
 * `energy-metrics.ts`'s own `producedKwh + importedKwh - exportedKwh`
 * identity). The previous version of this function derived Home this way
 * and then clamped a negative result to zero - which satisfies neither
 * equation (e.g. the real production incident this milestone was written
 * to fix: PV 0.1 kW, Home clamped to 0.0 kW, Export 33.9 kW - `0.1 != 0 +
 * 33.9`, an impossible combination that just happened to not be negative).
 *
 * The real root cause: this plant's real-time inverter power reading is
 * already documented elsewhere (`energy-metrics.ts`'s `peakExport` doc
 * comment) as reading near-zero even during genuine substantial export,
 * since it's a different measurement point than the meter - not sensor
 * noise, a confirmed, persistent discrepancy. The meter (Export/Import) is
 * the reliable reading everywhere else in this app (revenue, KPIs), so in
 * Case A the displayed PV is floored at Export - you cannot export more
 * than you produce, so real PV is *at least* Export whenever Export > 0,
 * even if the inverter's instantaneous reading momentarily under-reports.
 * This is not fabricating a value: it's a physically necessary lower bound
 * applied to a reading already known to sometimes be too low, chosen so
 * the *displayed* PV is what makes the equation hold exactly. Case B never
 * needs this adjustment - addition of two non-negative readings can't
 * produce an inconsistent result.
 */
function conserveEnergyFlow(
  rawPvKw: number,
  exportKw: number,
  importKw: number,
): { pvKw: number; consumptionKw: number; gridImportKw: number; gridExportKw: number; direction: "importing" | "exporting" } {
  if (importKw > 0) {
    return {
      pvKw: rawPvKw,
      consumptionKw: Math.round((rawPvKw + importKw) * 100) / 100,
      gridImportKw: importKw,
      gridExportKw: 0,
      direction: "importing",
    };
  }

  const pvKw = Math.max(rawPvKw, exportKw);

  return {
    pvKw,
    consumptionKw: Math.round((pvKw - exportKw) * 100) / 100,
    gridImportKw: 0,
    gridExportKw: exportKw,
    direction: "exporting",
  };
}

function toEnergyFlowPoint(point: PlantTelemetrySeriesPoint): EnergyFlowPoint {
  if (point.productionKw === null || point.exportKw === null || point.importKw === null) {
    return { time: point.timestamp.getTime(), pvKw: null, consumptionKw: null, gridImportKw: null, gridExportKw: null };
  }

  const flow = conserveEnergyFlow(point.productionKw, point.exportKw, point.importKw);

  return {
    time: point.timestamp.getTime(),
    pvKw: flow.pvKw,
    consumptionKw: flow.consumptionKw,
    gridImportKw: flow.gridImportKw,
    gridExportKw: flow.gridExportKw,
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

  const flow = conserveEnergyFlow(
    production.currentProduction.kw,
    production.currentExport.kw,
    production.currentImport.kw,
  );

  return {
    available: true,
    pvKw: flow.pvKw,
    consumptionKw: flow.consumptionKw,
    direction: flow.direction,
    gridKw: flow.direction === "importing" ? flow.gridImportKw : flow.gridExportKw,
  };
}

/** Uses `energyFlow`'s already-conserved `pvKw` (never the raw inverter reading) so the chart's NOW marker never contradicts the System Overview diagram above it. */
function buildNowAnnotation(energyFlow: EnergyFlowState): string | undefined {
  const parts: string[] = [];

  if (energyFlow.available) {
    parts.push(`${energyFlow.pvKw} kW PV`);
    parts.push(
      `${energyFlow.gridKw} kW ${energyFlow.direction === "importing" ? "import" : "export"}`,
    );
  }

  return parts.length > 0 ? parts.join(" · ") : undefined;
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
  // the same [dayStart, now) window. This is the one telemetry snapshot
  // every KPI, the energy-flow diagram's "today" total, and the chart all
  // derive from - see this module's top doc comment.
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
