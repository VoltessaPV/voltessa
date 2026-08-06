"use server";

import type { MarketPricePoint } from "@/app/[locale]/(platform)/market/market-data";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { replayCapacityScenario, type ReplayOutcome } from "@/lib/digital-twin/replay-engine";
import { dbMarketPriceProvider } from "@/lib/market-price/provider";
import { localDayBoundsUtc, localMonthBoundsUtc, localWeekBoundsUtc, previousPeriodBoundsUtc } from "@/lib/market-price/timezone";
import { prisma } from "@/lib/prisma";
import type { SettlementEnergyPoint } from "@/lib/telemetry/energy-metrics";

const BULGARIA_TIMEZONE = "Europe/Sofia";

export type DigitalTwinPeriod = "previous-day" | "previous-week" | "previous-month" | "custom";

export type DigitalTwinMetrics = {
  productionKwh: number;
  exportedKwh: number;
  importedKwh: number;
  selfConsumptionKwh: number;
  revenueEur: number | null;
};

export type DigitalTwinResult =
  | {
      ok: true;
      rangeStart: Date;
      rangeEnd: Date;
      currentCapacityKw: number;
      newCapacityKw: number;
      capacityFactor: number;
      current: DigitalTwinMetrics;
      simulated: DigitalTwinMetrics;
      priceSeries: MarketPricePoint[];
      currentSettlementSeries: SettlementEnergyPoint[];
      simulatedSettlementSeries: SettlementEnergyPoint[];
    }
  | { ok: false; error: string };

/**
 * The engine's own internal 15-minute aggregation, unchanged - reproduced
 * here (not exported from `replay-engine.ts`, per the explicit instruction
 * not to touch the Simulation Engine for this milestone) purely to feed
 * `MarketPriceChart`'s existing prop shape. Mechanical bucketing only - the
 * `ScenarioInterval[]` it consumes already comes entirely from
 * `replayCapacityScenario`, no new calculation happens here.
 */
function aggregateNativeIntervalsTo15Min(intervals: ReplayOutcome["intervals"]): SettlementEnergyPoint[] {
  const bucketMs = 15 * 60 * 1000;
  const buckets = new Map<number, { exportedKwh: number | null; importedKwh: number | null }>();

  for (const interval of intervals) {
    const bucketStart = Math.floor(interval.intervalStart.getTime() / bucketMs) * bucketMs;
    const existing = buckets.get(bucketStart) ?? { exportedKwh: null, importedKwh: null };

    buckets.set(bucketStart, {
      exportedKwh:
        interval.newExport !== null ? (existing.exportedKwh ?? 0) + interval.newExport : existing.exportedKwh,
      importedKwh:
        interval.newImport !== null ? (existing.importedKwh ?? 0) + interval.newImport : existing.importedKwh,
    });
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, v]) => ({ intervalStart: new Date(t), exportedKwh: v.exportedKwh, importedKwh: v.importedKwh }));
}

/**
 * Self-consumption is never recomputed independently - the replay engine
 * reconstructs `historicalConsumption` exactly once, before the scenario
 * runs, and every simulated interval afterward only changes production;
 * export/import fall out of the single balance equation
 * (`replay-engine.ts`'s `runCapacityScenario`). Self-consumption is
 * therefore the direct consequence of that same balance -
 * `newProduction - newExport` (equivalently `historicalConsumption -
 * newImport`) - computed here only from the engine's own already-simulated
 * totals, never by calling `computeConsumedFromPv` (or any other function)
 * against raw/historical data during the simulation.
 */
function toMetrics(outcome: ReplayOutcome): DigitalTwinMetrics {
  return {
    productionKwh: outcome.totals.productionKwh,
    exportedKwh: outcome.totals.exportedKwh,
    importedKwh: outcome.totals.importedKwh,
    selfConsumptionKwh: Math.round((outcome.totals.productionKwh - outcome.totals.exportedKwh) * 100) / 100,
    revenueEur: outcome.revenue.available ? outcome.revenue.revenueEur : null,
  };
}

function resolveRange(
  period: DigitalTwinPeriod,
  customStart: string | undefined,
  customEnd: string | undefined,
): { start: Date; end: Date } {
  const now = new Date();

  if (period === "previous-day") {
    const todayStart = localDayBoundsUtc(now, BULGARIA_TIMEZONE).start;
    return previousPeriodBoundsUtc("today", todayStart, BULGARIA_TIMEZONE);
  }

  if (period === "previous-week") {
    const weekStart = localWeekBoundsUtc(now, BULGARIA_TIMEZONE).start;
    return previousPeriodBoundsUtc("week", weekStart, BULGARIA_TIMEZONE);
  }

  if (period === "previous-month") {
    const monthStart = localMonthBoundsUtc(now, BULGARIA_TIMEZONE).start;
    return previousPeriodBoundsUtc("month", monthStart, BULGARIA_TIMEZONE);
  }

  if (!customStart || !customEnd) {
    throw new Error("Custom range requires both a start and an end date");
  }

  return {
    start: localDayBoundsUtc(new Date(`${customStart}T12:00:00Z`), BULGARIA_TIMEZONE).start,
    end: localDayBoundsUtc(new Date(`${customEnd}T12:00:00Z`), BULGARIA_TIMEZONE).end,
  };
}

/**
 * Digital Twin's only Server Action. Every number the page displays comes
 * from `replayCapacityScenario` (called twice - once at the plant's real
 * current capacity, once at the administrator's chosen capacity) plus the
 * already-existing `computeConsumedFromPv` for self-consumption. No
 * business calculation happens in this file beyond composing those
 * existing, approved functions and resolving the requested period via
 * `lib/market-price/timezone.ts`'s existing calendar helpers.
 */
export async function runDigitalTwinSimulation(
  plantId: string,
  period: DigitalTwinPeriod,
  newCapacityKw: number,
  customStart?: string,
  customEnd?: string,
): Promise<DigitalTwinResult> {
  await requirePlatformAdmin();

  try {
    if (!Number.isFinite(newCapacityKw) || newCapacityKw <= 0) {
      return { ok: false, error: "New installed capacity must be a positive number" };
    }

    const plant = await prisma.plant.findUnique({ where: { id: plantId }, select: { capacityKw: true } });
    const currentCapacityKw = plant?.capacityKw ? Number(plant.capacityKw) : null;
    if (!currentCapacityKw) {
      return { ok: false, error: "Selected plant has no configured installed capacity" };
    }

    const { start, end } = resolveRange(period, customStart, customEnd);

    const [currentOutcome, simulatedOutcome, priceResult] = await Promise.all([
      replayCapacityScenario({ plantId, start, end, scenario: { type: "capacity", newCapacityKw: currentCapacityKw } }),
      replayCapacityScenario({ plantId, start, end, scenario: { type: "capacity", newCapacityKw } }),
      dbMarketPriceProvider.getPricesInRange({ start, end }),
    ]);

    // Same shape adapter `replay-engine.ts`'s own private `fetchPriceSeries`
    // uses internally - `exportEnabled` is never read by the chart or
    // `computeExportRevenue`, only present because this replays through the
    // exact `MarketPricePoint` type Market itself renders.
    const priceSeries: MarketPricePoint[] = priceResult.available
      ? priceResult.prices.map((row) => ({ timestamp: row.timestamp, price: row.price, exportEnabled: false }))
      : [];

    return {
      ok: true,
      rangeStart: start,
      rangeEnd: end,
      currentCapacityKw,
      newCapacityKw,
      capacityFactor: newCapacityKw / currentCapacityKw,
      current: toMetrics(currentOutcome),
      simulated: toMetrics(simulatedOutcome),
      priceSeries,
      currentSettlementSeries: aggregateNativeIntervalsTo15Min(currentOutcome.intervals),
      simulatedSettlementSeries: aggregateNativeIntervalsTo15Min(simulatedOutcome.intervals),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Simulation failed" };
  }
}
