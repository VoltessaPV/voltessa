"use server";

import type { MarketPricePoint } from "@/app/[locale]/(platform)/market/market-data";
import { requirePlatformAdmin } from "@/lib/auth/session";
import type { BatteryConfig } from "@/lib/digital-twin/battery-dispatch";
import { type BatteryIntervalDiagnostic, buildIntervalDiagnostics } from "@/lib/digital-twin/battery-diagnostics";
import { toBatteryDispatchIntervals } from "@/lib/digital-twin/battery-engine-report";
import { replay, type ReplayOutcome } from "@/lib/digital-twin/replay-engine";
import {
  aggregateAvailablePvSeriesForChart,
  aggregateFlowSeriesForChart,
  aggregatePriceSeriesForChart,
  aggregateSettlementSeriesForChart,
  aggregateSocSeriesForChart,
  resolveChartResolution,
  type AvailablePvEnergyPoint,
  type BatteryFlowPoint,
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
  /**
   * Available-PV visualization fix. Reconstructed Available PV (independent
   * of historical Zero Export, never derived from simulated battery output)
   * for the "Current (historical)" `MarketPriceChart` panel only - always
   * `undefined` on `simulatedChart`, which never renders this series. Same
   * `chartResolution` grid as `settlement`.
   */
  availablePv?: AvailablePvEnergyPoint[];
};

/**
 * Battery Digital Twin UI milestone. Every field here is read straight off
 * `ReplayOutcome.battery` (`lib/digital-twin/replay-engine.ts`) except
 * `capacityKwh`, which is the battery size the caller configured (an input
 * echoed back, not a simulation output - `ReplayOutcome` has no notion of
 * "capacity", only what the battery actually did).
 *
 * PV Charging Economics fix. PV energy has zero acquisition cost by
 * definition - a battery charging from PV surplus never "bought" that
 * energy at the market price, so a single market-price-weighted average
 * over every charging interval (the pre-fix `avgChargingPriceEurPerMwh`)
 * conflated PV's real €0/MWh acquisition cost with the market price that
 * happened to prevail while charging, which is only ever an opportunity
 * cost (what exporting instead would have earned), never a purchase price.
 * Split into two fields instead, using `mandatoryChargeKwh` -
 * `battery-dispatch.ts`'s own first-class PV-financed-portion-of-charge
 * field, generalized by the same fix to cover every interval, not only
 * Zero Export - to separate PV-financed from grid-financed charging:
 *
 * - `avgPvChargingAcquisitionPriceEurPerMwh`: always exactly 0 whenever any
 *   PV-financed charging occurred this horizon (PV has no acquisition
 *   cost), `null` when none did.
 * - `avgGridChargingPriceEurPerMwh`: the energy-weighted average market
 *   price paid for the grid-financed portion of charging only (only
 *   possible when `allowGridCharging` is true) - `null` when no
 *   grid-financed charging occurred.
 *
 * `avgDischargingPriceEurPerMwh` is unchanged in meaning - the
 * energy-weighted average market price over discharging intervals, since
 * discharge always either earns that price (export) or avoids paying it
 * (offset import), a real economic quantity either way. All three are
 * computed by `computeWeightedPrice` below straight from
 * `simulatedOutcome.intervals` and the same `priceSeries` this file already
 * fetches - never from `revenue`/`intervalRevenueEur` (which nets
 * export/import), per the Battery Price KPIs milestone's original "use
 * market prices directly" requirement.
 */
export type DigitalTwinBatteryMetrics = {
  capacityKwh: number;
  chargedEnergyKwh: number;
  dischargedEnergyKwh: number;
  throughputKwh: number;
  batteryLossesKwh: number;
  peakSocKwh: number;
  finalSocKwh: number;
  /** PV-financed portion of `chargedEnergyKwh` - `Σ mandatoryChargeKwh`. Zero acquisition cost by definition. */
  pvChargedEnergyKwh: number;
  /** Grid-financed portion of `chargedEnergyKwh` (`chargedEnergyKwh - pvChargedEnergyKwh`) - only nonzero when `allowGridCharging` is true. */
  gridChargedEnergyKwh: number;
  avgPvChargingAcquisitionPriceEurPerMwh: number | null;
  avgGridChargingPriceEurPerMwh: number | null;
  avgDischargingPriceEurPerMwh: number | null;
  /**
   * Battery Degradation Economics milestone. The optimizer's own internal
   * `Σ price × (exported - imported) / 1000` objective component (export
   * revenue AND avoided-import value together) - deliberately a DIFFERENT
   * figure from `DigitalTwinMetrics.revenueEur` above (which stays
   * export-only, unchanged, per the existing Revenue Engine contract).
   */
  marketValueEur: number;
  /** `battery.degradationCostPerKwh * throughputKwh` - an estimate only, never subtracted from `revenueEur` or `marketValueEur`. */
  batteryWearCostEur: number;
  /** `marketValueEur - batteryWearCostEur` - the value the optimizer actually maximizes, never itself labeled "Revenue". */
  optimizationValueEur: number;
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
       * Charge/discharge per bucket, aggregated (summed - an energy flow,
       * not a state) to the exact same `chartResolution` grid
       * `simulatedSocChart` already uses, so the two can be joined by exact
       * timestamp on the chart. Empty when the battery scenario is disabled.
       */
      simulatedFlowChart: BatteryFlowPoint[];
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
 * `ReplayIntervalOutcome[]` it consumes always comes from `replay` at
 * native 5-minute resolution (both the no-battery and, since the
 * Zero-Export dispatch fix, the battery-enabled path), no new calculation
 * happens here.
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
 * Available-PV visualization fix. Same native-5-minute -> 15-minute
 * bucketing as `aggregateNativeIntervalsTo15Min` above, kept as its own
 * function (rather than extending that one's return type) since
 * `availablePvKwh` is unrelated to `SettlementEnergyPoint` - only the
 * "Current (historical)" panel ever reads this. Reads `availablePvKwh`
 * directly off `ReplayOutcome.intervals` - the reconstructed value
 * `available-pv-reconstruction.ts` produces, independent of historical Zero
 * Export - never `productionKwh` (post-capacity-scaling) or any
 * battery/simulated field.
 */
function aggregateAvailablePvTo15Min(intervals: ReplayOutcome["intervals"]): AvailablePvEnergyPoint[] {
  const bucketMs = 15 * 60 * 1000;
  const buckets = new Map<number, number | null>();

  for (const interval of intervals) {
    const bucketStart = Math.floor(interval.intervalStart.getTime() / bucketMs) * bucketMs;
    const existing = buckets.get(bucketStart);
    buckets.set(bucketStart, interval.availablePvKwh !== null ? (existing ?? 0) + interval.availablePvKwh : existing ?? null);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, availablePvKwh]) => ({ intervalStart: new Date(t), availablePvKwh }));
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

/** ENTSO-E's native day-ahead price resolution - the same constant battery-dispatch.ts's own internal price bucketing uses (`PRICE_BUCKET_MS`), duplicated here rather than imported since that one is a private module constant. */
const PRICE_BUCKET_MS = 15 * 60 * 1000;

/**
 * Battery Price KPIs milestone, generalized by the PV Charging Economics
 * fix. Energy-weighted average market price - `Σ(energy x price) /
 * Σ(energy)` - over exactly the intervals where `energyOf` returns a
 * positive amount and the market price is known. Reads `priceSeries` (the
 * same raw ENTSO-E series this file already fetches) directly, never
 * `revenue`/`intervalRevenueEur` - this must never be derived from realized
 * revenue. `intervals` is native 5-minute resolution while `priceSeries` is
 * ENTSO-E's native 15-minute grid (same bucketing bug and fix as
 * `computeMarketValueEur` below - an exact-timestamp lookup here originally
 * skipped 2 of every 3 intervals, understating both charging and
 * discharging price averages).
 */
function computeWeightedPrice(
  intervals: ReplayOutcome["intervals"],
  priceSeries: MarketPricePoint[],
  energyOf: (interval: ReplayOutcome["intervals"][number]) => number,
): number | null {
  const priceByTime = new Map(priceSeries.map((point) => [point.timestamp.getTime(), point.price]));

  let weightedSum = 0;
  let totalEnergyKwh = 0;

  for (const interval of intervals) {
    const energyKwh = energyOf(interval);
    if (!(energyKwh > 0)) {
      continue;
    }

    const bucket = Math.floor(interval.intervalStart.getTime() / PRICE_BUCKET_MS) * PRICE_BUCKET_MS;
    const price = priceByTime.get(bucket);
    if (price === undefined || price === null) {
      continue;
    }

    weightedSum += energyKwh * price;
    totalEnergyKwh += energyKwh;
  }

  return totalEnergyKwh > 0 ? Math.round((weightedSum / totalEnergyKwh) * 100) / 100 : null;
}

/** Matches `battery-diagnostics.ts`'s own `TOLERANCE_KWH` - floating-point residue from the continuous forward reconstruction can leave a technically-nonzero `mandatoryChargeKwh` (e.g. 0.01 kWh) that rounds to a displayed "0.0 kWh" total; without this tolerance, that residue would make `computeAvgPvChargingAcquisitionPrice` report 0 EUR/MWh even though no PV-financed charging is actually visible anywhere else on the page. */
const TOLERANCE_KWH = 0.02;

/**
 * PV Charging Economics fix. PV energy has zero acquisition cost by
 * construction (not a computed average - there is nothing to weight): this
 * returns exactly 0 whenever any PV-financed charging (`mandatoryChargeKwh`,
 * `battery-dispatch.ts` - generalized to every interval type by the same
 * fix) occurred this horizon, and `null` when none did (nothing to report).
 */
function computeAvgPvChargingAcquisitionPrice(intervals: ReplayOutcome["intervals"]): number | null {
  const anyPvFinancedCharge = intervals.some((interval) => (interval.mandatoryChargeKwh ?? 0) > TOLERANCE_KWH);
  return anyPvFinancedCharge ? 0 : null;
}

/** Grid-financed portion of an interval's `chargeKwh` - the complement of the PV-financed portion (`mandatoryChargeKwh`), only ever nonzero when `allowGridCharging` was true. */
function gridFinancedChargeKwh(interval: ReplayOutcome["intervals"][number]): number {
  return Math.max(0, (interval.chargeKwh ?? 0) - (interval.mandatoryChargeKwh ?? 0));
}

/**
 * Battery Degradation Economics milestone. The optimizer's own internal
 * market-value objective component - `Σ price × (exported - imported) /
 * 1000` over every interval - computed here from the same already-fetched
 * `priceSeries` and `simulatedOutcome.intervals` every other battery metric
 * on this page reads, never a second simulation. `intervals` is native
 * 5-minute resolution while `priceSeries` is ENTSO-E's native 15-minute
 * grid, so each interval resolves to the 15-minute bucket it falls within -
 * an exact-timestamp lookup would silently skip 2 of every 3 intervals.
 */
function computeMarketValueEur(intervals: ReplayOutcome["intervals"], priceSeries: MarketPricePoint[]): number {
  const priceByTime = new Map(priceSeries.map((point) => [point.timestamp.getTime(), point.price]));

  let total = 0;
  for (const interval of intervals) {
    const bucket = Math.floor(interval.intervalStart.getTime() / PRICE_BUCKET_MS) * PRICE_BUCKET_MS;
    const price = priceByTime.get(bucket);
    if (price === undefined || price === null) {
      continue;
    }
    const exportedKwh = interval.exportedKwh ?? 0;
    const importedKwh = interval.importedKwh ?? 0;
    total += (price * (exportedKwh - importedKwh)) / 1000;
  }

  return Math.round(total * 100) / 100;
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
    // strictly after the simulation, over its already-computed native
    // interval grid - never a second replay at a different resolution.
    // Current and Simulated always share the same `chartResolution` so the
    // two charts stay visually comparable; only their own export profile
    // (via `aggregatePriceSeriesForChart`'s weighting) can make their price
    // lines differ. Since the Zero-Export dispatch fix, both the no-battery
    // and battery-enabled paths return `ReplayOutcome.intervals` at native
    // 5-minute resolution - `aggregateNativeIntervalsTo15Min` below does
    // real bucketing for both, not a pure identity pass for either.
    const chartResolution = resolveChartResolution(start, end);
    const currentSettlement15Min = aggregateNativeIntervalsTo15Min(currentOutcome.intervals);
    const simulatedSettlement15Min = aggregateNativeIntervalsTo15Min(simulatedOutcome.intervals);

    // Available-PV visualization fix. "Current (historical)" only - reads
    // currentOutcome.intervals (never simulatedOutcome/battery output), the
    // reconstructed value independent of historical Zero Export.
    const currentAvailablePv15Min = aggregateAvailablePvTo15Min(currentOutcome.intervals);

    const simulatedBattery: DigitalTwinBatteryMetrics | null = (() => {
      if (!battery || !simulatedOutcome.battery) {
        return null;
      }
      const marketValueEur = computeMarketValueEur(simulatedOutcome.intervals, priceSeries);
      const batteryWearCostEur = Math.round(battery.degradationCostPerKwh * simulatedOutcome.battery.throughputKwh * 100) / 100;
      const pvChargedEnergyKwh =
        Math.round(simulatedOutcome.intervals.reduce((sum, i) => sum + (i.mandatoryChargeKwh ?? 0), 0) * 100) / 100;
      const gridChargedEnergyKwh =
        Math.round(simulatedOutcome.intervals.reduce((sum, i) => sum + gridFinancedChargeKwh(i), 0) * 100) / 100;
      return {
        capacityKwh: battery.capacityKwh,
        chargedEnergyKwh: simulatedOutcome.battery.chargedEnergyKwh,
        dischargedEnergyKwh: simulatedOutcome.battery.dischargedEnergyKwh,
        throughputKwh: simulatedOutcome.battery.throughputKwh,
        batteryLossesKwh: simulatedOutcome.battery.batteryLossesKwh,
        peakSocKwh: simulatedOutcome.battery.peakSocKwh,
        finalSocKwh: simulatedOutcome.battery.finalSocKwh,
        pvChargedEnergyKwh,
        gridChargedEnergyKwh,
        avgPvChargingAcquisitionPriceEurPerMwh: computeAvgPvChargingAcquisitionPrice(simulatedOutcome.intervals),
        avgGridChargingPriceEurPerMwh: computeWeightedPrice(simulatedOutcome.intervals, priceSeries, gridFinancedChargeKwh),
        avgDischargingPriceEurPerMwh: computeWeightedPrice(simulatedOutcome.intervals, priceSeries, (i) => i.dischargeKwh ?? 0),
        marketValueEur,
        batteryWearCostEur,
        optimizationValueEur: Math.round((marketValueEur - batteryWearCostEur) * 100) / 100,
      };
    })();

    const simulatedSocChart: SocPoint[] = simulatedBattery
      ? aggregateSocSeriesForChart(
          simulatedOutcome.intervals.map((interval) => ({ intervalStart: interval.intervalStart, socKwh: interval.socKwh })),
          chartResolution,
          BULGARIA_TIMEZONE,
        )
      : [];

    // Available-PV visibility fix. The same reconstructed Available PV
    // `runBatteryDispatch` dispatched against - never historical
    // export/Zero-Export - aggregated onto the exact same bucket grid as
    // SOC/charge/discharge so the chart can render it as its own series
    // (gray bars) on one shared time axis.
    const simulatedFlowChart: BatteryFlowPoint[] = simulatedBattery
      ? aggregateFlowSeriesForChart(
          simulatedOutcome.intervals.map((interval) => ({
            intervalStart: interval.intervalStart,
            chargeKwh: interval.chargeKwh,
            dischargeKwh: interval.dischargeKwh,
            availablePvKwh: interval.availablePvKwh,
          })),
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
      simulatedFlowChart,
      diagnostics,
      chartResolution,
      currentChart: {
        price: aggregatePriceSeriesForChart(priceSeries, currentSettlement15Min, chartResolution, BULGARIA_TIMEZONE),
        settlement: aggregateSettlementSeriesForChart(currentSettlement15Min, chartResolution, BULGARIA_TIMEZONE),
        availablePv: aggregateAvailablePvSeriesForChart(currentAvailablePv15Min, chartResolution, BULGARIA_TIMEZONE),
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
