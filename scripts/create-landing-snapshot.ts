/**
 * One-time snapshot generator for the landing page's product preview.
 *
 * Reads today's REAL production data (this organization's one real Huawei
 * plant) and today's REAL ENTSO-E day-ahead prices, freezes everything at
 * 14:35 local (Europe/Sofia) time, scales every production-related figure
 * ×3 (approximating a 500–600 kWp installation from the real ~200 kWp
 * plant), and writes the result as a plain, literal TypeScript object to
 * `apps/web/lib/demo/landing-snapshot.ts`.
 *
 * Every derived number (revenue, energy-flow consumption, export
 * recommendation, inverter status, price distribution/insights,
 * configured-export-mode label) is produced by calling this codebase's own
 * real, already-exported pure helpers — nothing here reimplements decision
 * or business logic, only reads + scales + reuses.
 *
 * This script is the ONLY place that ever touches Prisma/Huawei/ENTSO-E for
 * the landing page. Run it manually, on demand, to refresh the snapshot to
 * a new day — the landing page itself never executes it, never fetches
 * data, and never depends on the database at runtime.
 *
 * Usage: from apps/web, `npx tsx --env-file=.env.local ../../scripts/create-landing-snapshot.ts`
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, "../apps/web");

for (const file of [".env.local", ".env"]) {
  const fullPath = path.join(webDir, file);
  if (existsSync(fullPath)) {
    dotenv.config({ path: fullPath });
  }
}

import { prisma } from "../apps/web/lib/prisma";
import { isExportRecommended, type ExportThresholdConfig } from "../apps/web/lib/automation/export-threshold-config";
import { describeConfiguredExportMode } from "../apps/web/lib/fusionsolar/get-export-control-status";
import { classifyInverterState } from "../apps/web/lib/fusionsolar/get-plant-inverter-status";
import { dbMarketPriceProvider } from "../apps/web/lib/market-price/provider";
import { computeExportRevenue } from "../apps/web/lib/market-price/revenue";
import { formatDateInZone, localDayBoundsUtc } from "../apps/web/lib/market-price/timezone";
import { deriveEnergyFlow } from "../apps/web/lib/telemetry/energy-flow";
import {
  getPlantSettlementEnergySeries,
  getPlantTelemetrySeries,
  sumSettlementEnergy,
} from "../apps/web/lib/telemetry/energy-metrics";
import { getPlantDailyKpi } from "../apps/web/lib/telemetry/plant-daily-kpi";
import { INVERTER_DEV_TYPE_ID, METER_DEV_TYPE_ID } from "../apps/web/lib/telemetry/queries";
import { buildDistribution, buildInsights } from "../apps/web/app/(platform)/market/market-data";

import type { DashboardKpis, DashboardMarketWidgetData, DashboardPageData, EnergyFlowPoint } from "../apps/web/app/(platform)/dashboard/dashboard-data";
import type { MarketEventLogEntry, MarketPageResult, MarketPricePoint, MarketSummaryData } from "../apps/web/app/(platform)/market/market-data";
import type { ProductionPageData, ProductionReading } from "../apps/web/app/(platform)/market/production-data";

const SCALE = 3;
const BULGARIA_TIMEZONE = "Europe/Sofia";
const TELEMETRY_GRID_MINUTES = 5;
const SETTLEMENT_INTERVAL_MINUTES = 15;
const FREEZE_HOUR = 14;
const FREEZE_MINUTE = 35;
const THRESHOLD: ExportThresholdConfig = { minimumExportPrice: 15, currency: "EUR" };

function sofiaTimeLabel(date: Date): string {
  return date.toLocaleTimeString("en-GB", { timeZone: BULGARIA_TIMEZONE, hour: "2-digit", minute: "2-digit" });
}

function formatValue(value: unknown): string {
  if (value instanceof Date) {
    return `new Date(${JSON.stringify(value.toISOString())})`;
  }
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) {
    return `[${value.map(formatValue).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${formatValue(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function main() {
  const plant = await prisma.plant.findFirst({
    where: { vendor: "Huawei", stationCode: { not: null }, plantCode: { not: null } },
    select: { id: true, name: true, capacityKw: true },
  });

  if (!plant) {
    throw new Error("No real Huawei plant found — cannot build a snapshot from real data.");
  }

  const referenceInstant = new Date();
  const todayDateStr = formatDateInZone(referenceInstant, BULGARIA_TIMEZONE);
  const { start: dayStart, end: dayEnd } = localDayBoundsUtc(referenceInstant, BULGARIA_TIMEZONE);
  const frozenNow = new Date(dayStart.getTime() + (FREEZE_HOUR * 60 + FREEZE_MINUTE) * 60 * 1000);

  const installedCapacityKw = plant.capacityKw ? Number(plant.capacityKw.toString()) * SCALE : null;

  // ---- Dashboard chart series (5-min grid, full day, real up to 14:35) ----

  const rawSeries = await getPlantTelemetrySeries(plant.id, dayStart, frozenNow);
  const byTime = new Map(rawSeries.map((p) => [p.timestamp.getTime(), p]));
  const chartSeries: EnergyFlowPoint[] = [];

  for (let t = dayStart.getTime(); t < dayEnd.getTime(); t += TELEMETRY_GRID_MINUTES * 60 * 1000) {
    const point = t <= frozenNow.getTime() ? byTime.get(t) : undefined;

    if (!point || point.productionKw === null || point.exportKw === null || point.importKw === null) {
      chartSeries.push({ time: t, pvKw: null, consumptionKw: null, gridImportKw: null, gridExportKw: null });
      continue;
    }

    const pv = point.productionKw * SCALE;
    const exportKw = point.exportKw * SCALE;
    const importKw = point.importKw * SCALE;
    const flow = deriveEnergyFlow(pv, exportKw, importKw);

    chartSeries.push({
      time: t,
      pvKw: flow.available ? flow.pvKw : null,
      consumptionKw: flow.available && flow.consumption.consistent ? flow.consumption.kw : null,
      gridImportKw: flow.available && flow.direction === "importing" ? flow.gridKw : 0,
      gridExportKw: flow.available && flow.direction === "exporting" ? flow.gridKw : 0,
    });
  }

  // ---- Dashboard KPIs (real PlantDailyKpi + settlement energy, both scaled ×3) ----

  const dailyKpi = await getPlantDailyKpi(plant.id, dayStart);
  const settlementSeriesRaw = await getPlantSettlementEnergySeries(plant.id, dayStart, frozenNow, SETTLEMENT_INTERVAL_MINUTES);
  const settlementEnergySeries = settlementSeriesRaw.map((p) => ({
    intervalStart: p.intervalStart,
    exportedKwh: p.exportedKwh !== null ? Math.round(p.exportedKwh * SCALE * 100) / 100 : null,
    importedKwh: p.importedKwh !== null ? Math.round(p.importedKwh * SCALE * 100) / 100 : null,
  }));
  const settlementTotals = sumSettlementEnergy(settlementEnergySeries);

  const producedTodayKwh = dailyKpi.available ? Math.round(dailyKpi.producedKwh * SCALE * 100) / 100 : null;
  const totalYieldKwh = dailyKpi.available && dailyKpi.totalYieldKwh !== null ? Math.round(dailyKpi.totalYieldKwh * SCALE * 100) / 100 : null;
  const consumedTodayKwh = dailyKpi.available ? Math.round(dailyKpi.consumedKwh * SCALE * 100) / 100 : null;
  const exportedTodayKwh = settlementTotals.available ? settlementTotals.exportedKwh : null;
  const importedTodayKwh = settlementTotals.available ? settlementTotals.importedKwh : null;
  const consumedFromPvKwh =
    producedTodayKwh !== null && exportedTodayKwh !== null && producedTodayKwh >= exportedTodayKwh
      ? Math.round((producedTodayKwh - exportedTodayKwh) * 100) / 100
      : null;

  // ---- Inverters, as of 14:35 (real state codes, scaled power) ----

  const inverterDevices = await prisma.device.findMany({
    where: { plantId: plant.id, devTypeId: INVERTER_DEV_TYPE_ID },
    select: { id: true, devName: true },
  });

  // Fictional, Huawei-style display names — the real devName values are
  // this organization's actual production serial numbers and must never
  // appear in a public marketing snapshot. Deterministic (not derived from
  // the real name), so the snapshot never leaks real device identifiers.
  const FICTIONAL_INVERTER_NAMES = [
    "SUN2000A23X9B10451",
    "SUN2000A23X9B10452",
    "SUN2000A23X9B10453",
    "SUN2000A23X9B10454",
  ];

  const inverters = await Promise.all(
    inverterDevices.map(async (device, index) => {
      const row = await prisma.deviceTelemetry.findFirst({
        where: { deviceId: device.id, timestamp: { lte: frozenNow } },
        select: { activePower: true, inverterState: true },
        orderBy: { timestamp: "desc" },
      });
      const classification = classifyInverterState(row?.inverterState ?? null);
      const powerKw = row?.activePower ? Math.round(row.activePower.toNumber() * SCALE * 100) / 100 : null;

      return {
        deviceId: device.id,
        name: FICTIONAL_INVERTER_NAMES[index % FICTIONAL_INVERTER_NAMES.length],
        online: classification.online,
        powerKw,
        statusColor: classification.color,
        statusLabel: classification.label,
      };
    }),
  );

  // ---- Current (14:35) production/export/import, as of the freeze instant ----

  const currentProductionKw = Math.round(
    inverters.reduce((sum, inv) => sum + (inv.powerKw ?? 0), 0) * 100,
  ) / 100;

  const meterRow = await prisma.deviceTelemetry.findFirst({
    where: { plantId: plant.id, devTypeId: METER_DEV_TYPE_ID, timestamp: { lte: frozenNow } },
    select: { meterActivePower: true },
    orderBy: { timestamp: "desc" },
  });
  const meterKw = meterRow?.meterActivePower ? meterRow.meterActivePower.toNumber() * SCALE : null;
  const currentExport: ProductionReading = meterKw !== null ? { available: true, kw: meterKw > 0 ? Math.round(meterKw * 100) / 100 : 0 } : { available: false, reason: "no_telemetry" };
  const currentImport: ProductionReading = meterKw !== null ? { available: true, kw: meterKw < 0 ? Math.round(Math.abs(meterKw) * 100) / 100 : 0 } : { available: false, reason: "no_telemetry" };
  const currentProduction: ProductionReading = { available: true, kw: currentProductionKw };

  const energyFlow =
    currentExport.available && currentImport.available
      ? deriveEnergyFlow(currentProductionKw, currentExport.kw, currentImport.kw)
      : { available: false as const };

  const configuredExportModeLabel = describeConfiguredExportMode({ available: false, reason: "configuration_endpoint_failed" });

  // ---- Market: real ENTSO-E day-ahead prices for today, frozen, unscaled ----

  const dayAhead = await dbMarketPriceProvider.getDayAheadPrices({ referenceDate: referenceInstant, timeZone: BULGARIA_TIMEZONE });
  if (!dayAhead.available) {
    throw new Error("No real ENTSO-E day-ahead prices available for today — cannot build a real snapshot.");
  }
  const importStatus = await dbMarketPriceProvider.getLatestImportStatus();
  const resolutionMinutes = importStatus.available ? importStatus.resolutionMinutes : SETTLEMENT_INTERVAL_MINUTES;

  const priceByTime = new Map(dayAhead.prices.map((p) => [p.timestamp.getTime(), p.price]));
  const series: MarketPricePoint[] = [];
  for (let t = dayStart.getTime(); t < dayEnd.getTime(); t += resolutionMinutes * 60 * 1000) {
    const price = priceByTime.get(t) ?? null;
    series.push({
      timestamp: new Date(t),
      price,
      exportEnabled: price !== null && isExportRecommended(price, THRESHOLD),
    });
  }
  const knownPoints = series.filter((p) => p.price !== null);

  const nowIndex = knownPoints.findIndex((p) => p.timestamp.getTime() >= frozenNow.getTime());
  const currentIndex = nowIndex === -1 ? knownPoints.length - 1 : Math.max(0, nowIndex - 1);
  const currentPoint = knownPoints[currentIndex];
  const previousPoint = currentIndex > 0 ? knownPoints[currentIndex - 1] : undefined;
  const nextPoint = currentIndex < knownPoints.length - 1 ? knownPoints[currentIndex + 1] : undefined;

  const currentPrice: MarketSummaryData["currentPrice"] = currentPoint
    ? {
        value: currentPoint.price as number,
        currency: "EUR",
        intervalLabel: sofiaTimeLabel(currentPoint.timestamp),
        deltaVsPrevious: previousPoint ? Math.round(((currentPoint.price as number) - (previousPoint.price as number)) * 100) / 100 : 0,
      }
    : null;

  const nextInterval: MarketSummaryData["nextInterval"] =
    nextPoint && nextPoint.price !== null && currentPoint
      ? {
          value: nextPoint.price,
          intervalLabel: sofiaTimeLabel(nextPoint.timestamp),
          direction: nextPoint.price > (currentPoint.price as number) ? "up" : nextPoint.price < (currentPoint.price as number) ? "down" : "flat",
        }
      : null;

  const lowestKnown = knownPoints.reduce((min, p) => ((p.price as number) < (min.price as number) ? p : min));
  const highestKnown = knownPoints.reduce((max, p) => ((p.price as number) > (max.price as number) ? p : max));

  const revenue = computeExportRevenue(series, settlementEnergySeries);

  // ---- Event log: derived from real threshold-crossing transitions up to 14:35 ----

  const eventLog: MarketEventLogEntry[] = [];
  let previousEnabled: boolean | null = null;
  for (const point of series) {
    if (point.timestamp.getTime() > frozenNow.getTime()) break;
    if (point.price === null) continue;

    if (previousEnabled === null) {
      previousEnabled = point.exportEnabled;
      continue;
    }

    if (point.exportEnabled !== previousEnabled) {
      eventLog.push(
        point.exportEnabled
          ? { timestamp: point.timestamp, type: "export_enabled", label: "Export resumed", detail: `Day-ahead price rose to ${point.price} EUR/MWh, above the ${THRESHOLD.minimumExportPrice} EUR/MWh threshold` }
          : { timestamp: point.timestamp, type: "export_stopped", label: "Export paused", detail: `Day-ahead price fell to ${point.price} EUR/MWh, below the ${THRESHOLD.minimumExportPrice} EUR/MWh threshold` },
      );
      previousEnabled = point.exportEnabled;
    }
  }
  if (eventLog.length > 0) {
    eventLog[0] = { ...eventLog[0], type: "threshold_crossed", label: "Price crossed export threshold" };
  }

  // ---- Assemble ----

  const kpis: DashboardKpis = {
    producedTodayKwh,
    totalYieldKwh,
    consumedTodayKwh,
    consumedFromPvKwh,
    exportedTodayKwh,
    importedTodayKwh,
    revenue,
  };

  const marketWidget: DashboardMarketWidgetData = {
    currentPrice,
    exportRecommended: currentPrice ? isExportRecommended(currentPrice.value, THRESHOLD) : null,
    threshold: THRESHOLD,
  };

  const dashboardData: Extract<DashboardPageData, { plantAvailable: true }> = {
    plantAvailable: true,
    selectedDate: todayDateStr,
    isToday: true,
    prevDateParam: todayDateStr,
    nextDateParam: todayDateStr,
    plantName: plant.name,
    kpis,
    energyFlow,
    chartSeries,
    nowAnnotation: energyFlow.available ? `${energyFlow.pvKw} kW PV · ${energyFlow.gridKw} kW ${energyFlow.direction === "importing" ? "import" : "export"}` : undefined,
    inverters: { available: true, inverters },
    latestTelemetryAt: frozenNow,
    market: marketWidget,
    eventLog,
    // The Solar Weather widget calls Open-Meteo live (lib/weather/openMeteo.ts) —
    // this frozen marketing snapshot deliberately never performs that I/O
    // (see this script's own doc comment), so the widget renders its
    // "temporarily unavailable" state on the landing page preview.
    weather: null,
  };

  const marketData: Extract<MarketPageResult, { dataAvailable: true }> = {
    dataAvailable: true,
    selectedDate: todayDateStr,
    isToday: true,
    prevDateParam: todayDateStr,
    nextDateParam: todayDateStr,
    threshold: THRESHOLD,
    series,
    isPartialImport: importStatus.available ? importStatus.isPartial : false,
    summary: {
      currentPrice,
      nextInterval,
      lowestToday: { value: lowestKnown.price as number, intervalLabel: sofiaTimeLabel(lowestKnown.timestamp) },
      highestToday: { value: highestKnown.price as number, intervalLabel: sofiaTimeLabel(highestKnown.timestamp) },
      marketStatus: { country: "Bulgaria", source: "ENTSO-E", healthy: importStatus.available ? !importStatus.isPartial : false },
    },
    eventLog,
    distribution: buildDistribution(knownPoints),
    insights: buildInsights(knownPoints, resolutionMinutes),
  };

  const productionData: ProductionPageData = {
    currentProduction,
    currentExport,
    currentImport,
    configuredExportMode: { available: false, reason: "configuration_endpoint_failed" },
    configuredExportModeLabel,
    settlementEnergySeries,
    installedCapacityKw,
    latestTelemetryAt: frozenNow,
  };

  const output = `/**
 * FROZEN LANDING PAGE SNAPSHOT — generated by scripts/create-landing-snapshot.ts.
 * Do not hand-edit. Re-run the script to regenerate.
 *
 * Real production data from this organization's Huawei plant + real
 * ENTSO-E day-ahead prices, frozen at ${sofiaTimeLabel(frozenNow)} Europe/Sofia on
 * ${todayDateStr}. Every production-related figure is the
 * real measured value × ${SCALE} (approximating a 500-600 kWp installation from
 * the real ~${plant.capacityKw?.toString()} kWp plant). Market prices are the real,
 * unscaled ENTSO-E values for this day. This file contains only literal data —
 * no Prisma, no Huawei, no ENTSO-E, no function calls that perform I/O.
 */

import type { DashboardPageData } from "@/app/(platform)/dashboard/dashboard-data";
import type { MarketPageResult } from "@/app/(platform)/market/market-data";
import type { ProductionPageData } from "@/app/(platform)/market/production-data";

export const SNAPSHOT_DASHBOARD_DATA: Extract<DashboardPageData, { plantAvailable: true }> = ${formatValue(dashboardData)};

export const SNAPSHOT_MARKET_DATA: Extract<MarketPageResult, { dataAvailable: true }> = ${formatValue(marketData)};

export const SNAPSHOT_PRODUCTION_DATA: ProductionPageData = ${formatValue(productionData)};
`;

  const outPath = path.join(webDir, "lib/demo/landing-snapshot.ts");
  await import("node:fs/promises").then((fs) => fs.writeFile(outPath, output, "utf-8"));

  console.log(`Snapshot written to ${outPath}`);
  console.log(`Frozen at ${sofiaTimeLabel(frozenNow)} Europe/Sofia, ${todayDateStr}`);
  console.log(`Plant: ${plant.name} (${plant.capacityKw?.toString()} kWp real -> ${installedCapacityKw} kWp scaled)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
