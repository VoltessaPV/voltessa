"use server";

import type { MarketPricePoint } from "@/app/[locale]/(platform)/market/market-data";
import { requirePlatformAdmin } from "@/lib/auth/session";
import type { BatteryConfig } from "@/lib/digital-twin/battery-dispatch";
import { type BatteryIntervalDiagnostic, buildIntervalDiagnostics } from "@/lib/digital-twin/battery-diagnostics";
import { toBatteryDispatchIntervals } from "@/lib/digital-twin/battery-engine-report";
import { replay, type ReplayOutcome } from "@/lib/digital-twin/replay-engine";
import {
  aggregatePriceSeriesForChart,
  aggregateSettlementSeriesForChart,
  aggregateSocSeriesForChart,
  resolveChartResolution,
  type ChartResolution,
  type SocPoint,
} from "@/lib/market-price/chart-aggregation";
import { dbMarketPriceProvider } from "@/lib/market-price/provider";
import { localDayBoundsUtc, localMonthBoundsUtc, localWeekBoundsUtc, previousPeriodBoundsUtc } from "@/lib/market-price/timezone";
import { prisma } from "@/lib/prisma";
import type { SettlementEnergyPoint } from "@/lib/telemetry/energy-metrics";
import type { PlantTopology } from "@/lib/telemetry/plant-topology";

const BULGARIA_TIMEZONE = "Europe/Sofia";

export type DigitalTwinPeriod = "previous-day" | "previous-week" | "previous-month" | "custom";

export type DigitalTwinMetrics = {
  productionKwh: number;
  exportedKwh: number;
  importedKwh: number;
  selfConsumptionKwh: number;
  revenueEur: number | null;
  /**
   * Final UI Polish milestone (Milestone 7). Read directly from the
   * existing Revenue Engine's own output (`RevenueSummary.averagePriceEurPerMwh`,
   * `lib/market-price/revenue.ts`) - never recalculated here.
   */
  averageSellingPriceEurPerMwh: number | null;
};

export type DigitalTwinChartSeries = {
  price: MarketPricePoint[];
  settlement: SettlementEnergyPoint[];
};

/**
 * Battery Digital Twin UI milestone. Every field here is read straight off
 * `ReplayOutcome.battery` (`lib/digital-twin/replay-engine.ts`) except
 * `capacityKwh`, which is the battery size the caller configured (an input
 * echoed back, not a simulation output - `ReplayOutcome` has no notion of
 * "capacity", only what the battery actually did).
 *
 * `avgChargingPriceEurPerMwh`/`avgDischargingPriceEurPerMwh` (Battery Price
 * KPIs milestone) are the one exception to "every field is a direct
 * ReplayOutcome read" - they're the energy-weighted average ENTSO-E market
 * price over exactly the intervals where the battery charged/discharged,
 * computed by `computeWeightedBatteryPrice` below straight from
 * `simulatedOutcome.intervals` and the same `priceSeries` this file already
 * fetches - never from `revenue`/`intervalRevenueEur` (which nets
 * export/import), per that milestone's explicit "use market prices
 * directly" requirement. `null` when no charging/discharging occurred.
 */
export type DigitalTwinBatteryMetrics = {
  capacityKwh: number;
  chargedEnergyKwh: number;
  dischargedEnergyKwh: number;
  throughputKwh: number;
  batteryLossesKwh: number;
  peakSocKwh: number;
  finalSocKwh: number;
  avgChargingPriceEurPerMwh: number | null;
  avgDischargingPriceEurPerMwh: number | null;
};

export type DigitalTwinResult =
  | {
      ok: true;
      rangeStart: Date;
      rangeEnd: Date;
      topology: PlantTopology;
      currentCapacityKw: number;
      newCapacityKw: number;
      capacityFactor: number;
      current: DigitalTwinMetrics;
      simulated: DigitalTwinMetrics;
      /** null when the battery scenario is disabled - "Current" never has a battery, only "Simulated" ever can. */
      simulatedBattery: DigitalTwinBatteryMetrics | null;
      /**
       * SOC is state, not an energy flow - `simulatedSocChart` is aggregated
       * via `aggregateSocSeriesForChart`'s last-value-per-bucket rule, never
       * summed/averaged like the settlement/price series. Empty when the
       * battery scenario is disabled.
       */
      simulatedSocChart: SocPoint[];
      /**
       * Platform-admin-only "Show Battery Diagnostics" toggle's data - the
       * engine's own already-computed per-interval diagnostics
       * (`buildIntervalDiagnostics`, `lib/digital-twin/battery-diagnostics.ts`),
       * exposed as-is. `null` when the battery scenario is disabled.
       */
      diagnostics: BatteryIntervalDiagnostic[] | null;
      /**
       * Adaptive Visualization milestone: the one resolution both charts
       * below are always aggregated to, so Current/Simulated stay visually
       * comparable - never mixed granularities.
       */
      chartResolution: ChartResolution;
      currentChart: DigitalTwinChartSeries;
      simulatedChart: DigitalTwinChartSeries;
    }
  | { ok: false; error: string };

/**
 * The engine's own internal 15-minute aggregation, unchanged - reproduced
 * here (not exported from `replay-engine.ts`, per the explicit instruction
 * not to touch the Simulation Engine for this milestone) purely to feed
 * `MarketPriceChart`'s existing prop shape. Mechanical bucketing only - the
 * `ReplayIntervalOutcome[]` it consumes already comes entirely from
 * `replay` (capacity-only scenario, native 5-minute resolution), no new
 * calculation happens here.
 */
function aggregateNativeIntervalsTo15Min(intervals: ReplayOutcome["intervals"]): SettlementEnergyPoint[] {
  const bucketMs = 15 * 60 * 1000;
  const buckets = new Map<number, { exportedKwh: number | null; importedKwh: number | null }>();

  for (const interval of intervals) {
    const bucketStart = Math.floor(interval.intervalStart.getTime() / bucketMs) * bucketMs;
    const existing = buckets.get(bucketStart) ?? { exportedKwh: null, importedKwh: null };

    buckets.set(bucketStart, {
      exportedKwh:
        interval.exportedKwh !== null ? (existing.exportedKwh ?? 0) + interval.exportedKwh : existing.exportedKwh,
      importedKwh:
        interval.importedKwh !== null ? (existing.importedKwh ?? 0) + interval.importedKwh : existing.importedKwh,
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
    averageSellingPriceEurPerMwh: outcome.revenue.available ? outcome.revenue.averagePriceEurPerMwh : null,
  };
}

/**
 * Battery Price KPIs milestone. Energy-weighted average market price over
 * exactly the intervals where `key` (charge or discharge) was positive and
 * the market price is known - `Σ(energy x price) / Σ(energy)`, per the
 * milestone's explicit formula. Reads `priceSeries` (the same raw ENTSO-E
 * series this file already fetches) directly, never `revenue`/
 * `intervalRevenueEur` - this must never be derived from realized revenue.
 */
function computeWeightedBatteryPrice(
  intervals: ReplayOutcome["intervals"],
  priceSeries: MarketPricePoint[],
  key: "chargeKwh" | "dischargeKwh",
): number | null {
  const priceByTime = new Map(priceSeries.map((point) => [point.timestamp.getTime(), point.price]));

  let weightedSum = 0;
  let totalEnergyKwh = 0;

  for (const interval of intervals) {
    const energyKwh = interval[key];
    if (energyKwh === null || energyKwh <= 0) {
      continue;
    }

    const price = priceByTime.get(interval.intervalStart.getTime());
    if (price === undefined || price === null) {
      continue;
    }

    weightedSum += energyKwh * price;
    totalEnergyKwh += energyKwh;
  }

  return totalEnergyKwh > 0 ? Math.round((weightedSum / totalEnergyKwh) * 100) / 100 : null;
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
 * from `replay` (called twice - once at the plant's real current capacity
 * with no battery for "Current", once at the administrator's chosen
 * capacity, optionally with a battery scenario, for "Simulated") plus the
 * already-existing `computeConsumedFromPv` for self-consumption. No
 * business calculation happens in this file beyond composing those
 * existing, approved functions and resolving the requested period via
 * `lib/market-price/timezone.ts`'s existing calendar helpers.
 *
 * Battery Digital Twin UI milestone: `battery` is entirely optional and, by
 * design, only ever applied to the "Simulated" replay - "Current" always
 * reflects what actually happened, and no battery ever existed historically.
 * `battery.capacityKwh` is the one value this file echoes back rather than
 * reading from `ReplayOutcome` (see `DigitalTwinBatteryMetrics`'s doc
 * comment) - everything else battery-related (charged/discharged energy,
 * throughput, losses, SOC, per-interval diagnostics) comes directly from
 * `simulatedOutcome.battery`/`simulatedOutcome.intervals`, never recomputed.
 */
export async function runDigitalTwinSimulation(
  plantId: string,
  period: DigitalTwinPeriod,
  newCapacityKw: number,
  battery: BatteryConfig | null,
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
      replay({ plantId, start, end, scenario: { capacityScenario: { newCapacityKw: currentCapacityKw } } }),
      replay({
        plantId,
        start,
        end,
        scenario: { capacityScenario: { newCapacityKw }, batteryScenario: battery ?? undefined },
      }),
      dbMarketPriceProvider.getPricesInRange({ start, end }),
    ]);

    // Same shape adapter `replay-engine.ts`'s own private `fetchPriceSeries`
    // uses internally - `exportEnabled` is never read by the chart or
    // `computeExportRevenue`, only present because this replays through the
    // exact `MarketPricePoint` type Market itself renders.
    const priceSeries: MarketPricePoint[] = priceResult.available
      ? priceResult.prices.map((row) => ({ timestamp: row.timestamp, price: row.price, exportEnabled: false }))
      : [];

    // Adaptive Visualization milestone (Milestone 6): aggregation happens
    // strictly after the simulation, over its already-computed 15-minute
    // settlement grid - never a second replay at a different resolution.
    // Current and Simulated always share the same `chartResolution` so the
    // two charts stay visually comparable; only their own export profile
    // (via `aggregatePriceSeriesForChart`'s weighting) can make their price
    // lines differ. When battery is enabled, `simulatedOutcome.intervals` is
    // already the battery engine's own native 15-minute grid - bucketing it
    // through the same 15-minute aggregator below is then a pure identity
    // pass (each interval already starts on a 15-minute boundary), not a
    // second calculation.
    const chartResolution = resolveChartResolution(start, end);
    const currentSettlement15Min = aggregateNativeIntervalsTo15Min(currentOutcome.intervals);
    const simulatedSettlement15Min = aggregateNativeIntervalsTo15Min(simulatedOutcome.intervals);

    const simulatedBattery: DigitalTwinBatteryMetrics | null =
      battery && simulatedOutcome.battery
        ? {
            capacityKwh: battery.capacityKwh,
            chargedEnergyKwh: simulatedOutcome.battery.chargedEnergyKwh,
            dischargedEnergyKwh: simulatedOutcome.battery.dischargedEnergyKwh,
            throughputKwh: simulatedOutcome.battery.throughputKwh,
            batteryLossesKwh: simulatedOutcome.battery.batteryLossesKwh,
            peakSocKwh: simulatedOutcome.battery.peakSocKwh,
            finalSocKwh: simulatedOutcome.battery.finalSocKwh,
            avgChargingPriceEurPerMwh: computeWeightedBatteryPrice(simulatedOutcome.intervals, priceSeries, "chargeKwh"),
            avgDischargingPriceEurPerMwh: computeWeightedBatteryPrice(simulatedOutcome.intervals, priceSeries, "dischargeKwh"),
          }
        : null;

    const simulatedSocChart: SocPoint[] = simulatedBattery
      ? aggregateSocSeriesForChart(
          simulatedOutcome.intervals.map((interval) => ({ intervalStart: interval.intervalStart, socKwh: interval.socKwh })),
          chartResolution,
          BULGARIA_TIMEZONE,
        )
      : [];

    const diagnostics: BatteryIntervalDiagnostic[] | null =
      battery && simulatedOutcome.battery
        ? buildIntervalDiagnostics(toBatteryDispatchIntervals(simulatedOutcome.intervals), priceSeries, battery)
        : null;

    return {
      ok: true,
      rangeStart: start,
      rangeEnd: end,
      topology: currentOutcome.topology,
      currentCapacityKw,
      newCapacityKw,
      capacityFactor: newCapacityKw / currentCapacityKw,
      current: toMetrics(currentOutcome),
      simulated: toMetrics(simulatedOutcome),
      simulatedBattery,
      simulatedSocChart,
      diagnostics,
      chartResolution,
      currentChart: {
        price: aggregatePriceSeriesForChart(priceSeries, currentSettlement15Min, chartResolution, BULGARIA_TIMEZONE),
        settlement: aggregateSettlementSeriesForChart(currentSettlement15Min, chartResolution, BULGARIA_TIMEZONE),
      },
      simulatedChart: {
        price: aggregatePriceSeriesForChart(priceSeries, simulatedSettlement15Min, chartResolution, BULGARIA_TIMEZONE),
        settlement: aggregateSettlementSeriesForChart(simulatedSettlement15Min, chartResolution, BULGARIA_TIMEZONE),
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Simulation failed" };
  }
}
