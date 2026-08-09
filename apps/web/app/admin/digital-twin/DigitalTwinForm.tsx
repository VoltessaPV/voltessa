"use client";

import { Suspense, useMemo, useState, useTransition } from "react";

import type { AutomationLabPlant } from "@/lib/admin/automation-lab-queries";
import {
  type BatteryConfig,
  computeDegradationCostPerKwh,
  DEFAULT_BATTERY_CAPEX_EUR_PER_KWH,
  DEFAULT_BATTERY_LIFETIME_EFC,
} from "@/lib/digital-twin/battery-dispatch";
import type { ChartResolution } from "@/lib/market-price/chart-aggregation";

import { DynamicBatterySocChart } from "@/components/charts/BatterySocChart.dynamic";
import { ChartSkeleton } from "@/components/charts/ChartSkeleton";
import {
  computeCapacityDerivedEnergyAxis,
  computeNiceEnergyAxis,
  computePriceAxisDomain,
} from "@/components/market/MarketPriceChart";
import { DynamicMarketPriceChart } from "@/components/market/MarketPriceChart.dynamic";
import { MarketSummaryCard, type MarketSummaryCardRow } from "@/components/market/MarketSummaryCard";

import { runDigitalTwinSimulation, type DigitalTwinPeriod, type DigitalTwinResult } from "./actions";
import { BatteryDiagnosticsPanel } from "./BatteryDiagnosticsPanel";

type Props = {
  plants: AutomationLabPlant[];
};

// Same dark-mode <select>/<option> fix as AutomationLabForm.tsx.
const selectClassName =
  "rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/80 [color-scheme:dark]";
const optionStyle = { backgroundColor: "#0f172a", color: "#f8fafc" };
const inputClassName =
  "rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/80 placeholder:text-white/30 [color-scheme:dark]";
const buttonClassName =
  "rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-blue-600";
const badgeClassName =
  "inline-flex items-center rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/80";

const PERIOD_OPTIONS: Array<{ id: DigitalTwinPeriod; label: string }> = [
  { id: "previous-day", label: "Previous day" },
  { id: "previous-week", label: "Previous week" },
  { id: "previous-month", label: "Previous month" },
  { id: "custom", label: "Custom range" },
];

const SLIDER_MULTIPLIER_MAX = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

type BatteryDurationPreset = "2h" | "4h" | "6h" | "custom";

const BATTERY_DURATION_OPTIONS: Array<{ id: BatteryDurationPreset; label: string; hours: number | null }> = [
  { id: "2h", label: "2-hour", hours: 2 },
  { id: "4h", label: "4-hour", hours: 4 },
  { id: "6h", label: "6-hour", hours: 6 },
  { id: "custom", label: "Custom", hours: null },
];

/**
 * KSTAR BluePulse BC220/BC240/BC260DE2A defaults review. The datasheet
 * confirms 90% DoD (-> `DEFAULT_MIN_SOC_PERCENT` below) and a 0.5C charge/
 * discharge rate (already reflected by the existing duration/plant-capacity
 * power model, unchanged). It does NOT state a round-trip efficiency
 * figure - 95.4% is this application's own pre-existing LiFePO4 model
 * assumption, not a KSTAR datasheet value, and is kept unchanged as such.
 */
const DEFAULT_ROUND_TRIP_EFFICIENCY_PERCENT = "95.4";
const DEFAULT_MIN_SOC_PERCENT = "10";
/** Fixed at 100 per `BatteryConfig`'s own spec - not a user input, matching `battery-dispatch.ts`'s documented V1 assumption. */
const MAX_SOC_PERCENT = 100;

/**
 * Conservative Battery Lifetime Planning Model milestone. A fixed, simple
 * planning horizon (aligned with the KSTAR reference material's stated
 * 10-year performance warranty, but NOT itself a manufacturer guarantee -
 * see the in-UI disclosure text) with a linear usable-capacity retention
 * curve from 100% at year 0 down to `END_OF_HORIZON_RETENTION_FRACTION` at
 * year `PLANNING_HORIZON_YEARS`. Deliberately not configurable and not
 * exposed as a UI input - a modeling assumption for conservative financial
 * planning, not a new battery engineering parameter.
 */
const PLANNING_HORIZON_YEARS = 10;
const END_OF_HORIZON_RETENTION_FRACTION = 0.8;

/**
 * `retention(year) = 1.0 - (1 - endOfHorizonRetention) x year / horizonYears`
 * - the exact simple linear curve requested: 100% at year 0, 80% at year 10,
 * monotonically declining in between. `year` is the whole-year index (1..10)
 * being projected, not a continuous time value.
 */
function capacityRetentionAtYear(year: number): number {
  return 1 - (1 - END_OF_HORIZON_RETENTION_FRACTION) * (year / PLANNING_HORIZON_YEARS);
}

/**
 * Lifetime revenue = sum of each planning year's projected revenue, where
 * each year's revenue is the Year-1 simulation-derived baseline scaled by
 * that year's modeled capacity retention - declining battery capacity means
 * declining ability to generate arbitrage revenue. This is a revenue
 * PROJECTION only; it never subtracts Battery Wear Cost or CAPEX (the
 * Investor Accounting Rule - degradation is reported separately, never
 * deducted from revenue).
 */
function sumProjectedLifetimeRevenue(year1AnnualRevenueEur: number): number {
  let total = 0;
  for (let year = 1; year <= PLANNING_HORIZON_YEARS; year += 1) {
    total += year1AnnualRevenueEur * capacityRetentionAtYear(year);
  }
  return total;
}

/**
 * Final UI Polish milestone (Milestone 7). One formatting convention for
 * the whole page - energy/power to 1 decimal, money/price to 2 - so no
 * value is ever shown as a raw, unrounded float. Every function here only
 * formats a number `runDigitalTwinSimulation` (or simple arithmetic on its
 * output) already produced; none of them compute a new business value.
 */
function formatKwh(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
}

function formatKw(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
}

function formatEur(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function formatAsp(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function formatSigned(value: number, format: (v: number) => string): string {
  return `${value >= 0 ? "+" : ""}${format(value)}`;
}

function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

/**
 * A plain (non-difference) percentage - no leading sign - for "Lifetime
 * used" style values. Two decimals (not one) so a small-but-real cycle
 * count (e.g. 1.07 / 6000 EFC = 0.0178%) still displays as a genuine
 * nonzero figure ("0.02%") rather than rounding away to "0.0%".
 */
function formatPercentPlain(value: number): string {
  return `${value.toFixed(2)}%`;
}

/** Cycle counts (EFC) - always shown to 2 decimals, matching money's own precision convention, never a raw float. */
function formatEfc(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

/**
 * Investor Lifetime Economics milestone. A simple, clearly-approximate
 * calendar breakdown (365-day year, 30-day month) for "estimated remaining
 * life at simulated cycling rate" - a projection, not a manufacturer
 * warranty, so exact calendar-day precision isn't the point.
 */
function daysToYearsMonthsDays(totalDays: number): { years: number; months: number; days: number } {
  const years = Math.floor(totalDays / 365);
  const afterYears = totalDays - years * 365;
  const months = Math.floor(afterYears / 30);
  const days = Math.round(afterYears - months * 30);
  return { years, months, days };
}

function formatRemainingLife(totalDays: number): string {
  const { years, months, days } = daysToYearsMonthsDays(totalDays);
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} year${years === 1 ? "" : "s"}`);
  if (months > 0) parts.push(`${months} month${months === 1 ? "" : "s"}`);
  if (days > 0 || parts.length === 0) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  return parts.join(", ");
}

function diffColorClass(diff: number): string {
  if (diff > 0) return "text-emerald-400";
  if (diff < 0) return "text-red-400";
  return "text-slate-400";
}

/**
 * A Current/Simulated/Difference row set for one KPI card - the exact
 * three lines the milestone's own worked example shows (e.g. "Current
 * 26,711.1 kWh / Simulated 50,216.9 kWh / Difference +23,505.8 kWh
 * (+88.0%)"). The percentage is omitted when `currentValue` isn't a
 * meaningful baseline to divide by (null, zero, or negative - e.g. an
 * Average Selling Price during a negative-price period).
 */
function buildComparisonRows(
  currentValue: number | null,
  simulatedValue: number | null,
  unit: string,
  format: (value: number) => string,
): MarketSummaryCardRow[] {
  const rows: MarketSummaryCardRow[] = [
    { label: "Current", value: currentValue !== null ? `${format(currentValue)} ${unit}` : "—" },
    { label: "Simulated", value: simulatedValue !== null ? `${format(simulatedValue)} ${unit}` : "—" },
  ];

  if (currentValue !== null && simulatedValue !== null) {
    const diff = simulatedValue - currentValue;
    const percent = currentValue > 0 ? ` (${formatPercent((diff / currentValue) * 100)})` : "";
    rows.push({
      label: "Difference",
      value: `${formatSigned(diff, format)} ${unit}${percent}`,
      valueColorClass: diffColorClass(diff),
    });
  }

  return rows;
}

type MetricSpec = {
  key: "productionKwh" | "importedKwh" | "exportedKwh" | "selfConsumptionKwh" | "revenueEur" | "averageSellingPriceEurPerMwh";
  label: string;
  unit: string;
  format: (value: number) => string;
};

const METRICS: MetricSpec[] = [
  { key: "productionKwh", label: "Production", unit: "kWh", format: formatKwh },
  { key: "importedKwh", label: "Import", unit: "kWh", format: formatKwh },
  { key: "exportedKwh", label: "Export", unit: "kWh", format: formatKwh },
  { key: "selfConsumptionKwh", label: "Self-consumption", unit: "kWh", format: formatKwh },
  { key: "revenueEur", label: "Revenue", unit: "EUR", format: formatEur },
  { key: "averageSellingPriceEurPerMwh", label: "Average Selling Price", unit: "EUR/MWh", format: formatAsp },
];

function formatRangeLabel(start: Date, end: Date): string {
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", dateStyle: "medium" });
  const inclusiveEnd = new Date(end.getTime() - 1);
  return `${formatter.format(start)} – ${formatter.format(inclusiveEnd)}`;
}

function periodDayCount(start: Date, end: Date): number {
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));
}

/**
 * Adaptive Visualization milestone (Milestone 6), badge text added in the
 * Final UI Polish milestone - purely presentational naming of the
 * resolution `runDigitalTwinSimulation` already chose and aggregated both
 * charts to server-side. Never decided here.
 */
function resolutionBadgeLabel(resolution: ChartResolution): string {
  if (resolution === "native") return "15-minute";
  if (resolution === "hourly") return "Hourly";
  return "Daily";
}

/**
 * Maps the resolution to one of `MarketPriceChart`'s existing `xAxisUnit`
 * values without modifying that component's tick-label behavior. "time"
 * locks fixed 90-minute ticks - correct only for the native 15-minute
 * grid, which always spans exactly one calendar day. "day" falls back to
 * recharts' own automatic tick placement - safe for both hourly- and
 * daily-bucketed data, exactly like Market's own Week/Month views already
 * rely on for their day-bucketed charts.
 */
function xAxisUnitFor(resolution: ChartResolution): "time" | "day" {
  return resolution === "native" ? "time" : "day";
}

/**
 * The page renders no business logic - every field here either collects an
 * input (plant, period, hypothetical capacity) or displays exactly what
 * `runDigitalTwinSimulation` (`./actions.ts`) returned, or simple arithmetic
 * on that output (differences, percentages, shared axis bounds). The
 * numeric capacity input is the source of truth (per spec); the slider is a
 * convenience that clamps its own visible range to a practical multiplier
 * but never limits what the number field can submit.
 */
export function DigitalTwinForm({ plants }: Props) {
  const [isPending, startTransition] = useTransition();
  const [plantId, setPlantId] = useState(plants[0]?.id ?? "");
  const [period, setPeriod] = useState<DigitalTwinPeriod>("previous-day");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [result, setResult] = useState<DigitalTwinResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedPlant = plants.find((plant) => plant.id === plantId);
  const currentCapacityKw = selectedPlant?.capacityKw ?? null;

  const [newCapacityInput, setNewCapacityInput] = useState<string>(
    currentCapacityKw !== null ? currentCapacityKw.toString() : "",
  );

  const newCapacityKw = Number(newCapacityInput);
  const capacityFactor =
    currentCapacityKw && Number.isFinite(newCapacityKw) && newCapacityKw > 0
      ? newCapacityKw / currentCapacityKw
      : null;

  const sliderMax = currentCapacityKw ? currentCapacityKw * SLIDER_MULTIPLIER_MAX : 100;
  const sliderValue = Math.min(Math.max(Number.isFinite(newCapacityKw) ? newCapacityKw : 0, 0), sliderMax);

  // Battery Digital Twin UI milestone. Every field here only feeds a
  // `BatteryConfig` object passed to `runDigitalTwinSimulation` unchanged -
  // the auto-derived capacity (duration x simulated capacity, matching
  // `battery-engine-report.ts`'s own `buildDefaultBatteryConfig` reference
  // convention) is the only arithmetic in this section, and it is exactly
  // the same class of convenience math the capacity slider above already
  // does client-side - never a business calculation over simulation data.
  const [batteryEnabled, setBatteryEnabled] = useState(false);
  const [durationPreset, setDurationPreset] = useState<BatteryDurationPreset>("2h");
  const [customCapacityInput, setCustomCapacityInput] = useState("");
  const [roundTripEfficiencyInput, setRoundTripEfficiencyInput] = useState(DEFAULT_ROUND_TRIP_EFFICIENCY_PERCENT);
  const [minSocInput, setMinSocInput] = useState(DEFAULT_MIN_SOC_PERCENT);
  const [maxChargePowerInput, setMaxChargePowerInput] = useState("");
  const [maxDischargePowerInput, setMaxDischargePowerInput] = useState("");
  const [allowGridCharging, setAllowGridCharging] = useState(false);
  // Investor Lifetime Economics milestone - the one new battery parameter:
  // the EFC lifetime assumption behind both `degradationCostPerKwh` (already
  // computed from it, unchanged) and the investor-facing cycles-used/
  // lifetime-used%/remaining-life reporting below.
  const [batteryLifetimeEfcInput, setBatteryLifetimeEfcInput] = useState(DEFAULT_BATTERY_LIFETIME_EFC.toString());
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const durationHours = BATTERY_DURATION_OPTIONS.find((option) => option.id === durationPreset)?.hours ?? null;
  const autoCapacityKwh =
    durationHours !== null && Number.isFinite(newCapacityKw) && newCapacityKw > 0 ? newCapacityKw * durationHours : null;
  const batteryCapacityKwh = durationPreset === "custom" ? Number(customCapacityInput) : autoCapacityKwh;

  const maxChargePowerKw = maxChargePowerInput !== "" ? Number(maxChargePowerInput) : newCapacityKw;
  const maxDischargePowerKw = maxDischargePowerInput !== "" ? Number(maxDischargePowerInput) : newCapacityKw;
  const roundTripEfficiencyPercent = Number(roundTripEfficiencyInput);
  const minSocPercent = Number(minSocInput);
  const batteryLifetimeEfc = Number(batteryLifetimeEfcInput);

  const batteryConfig: BatteryConfig | null =
    batteryEnabled &&
    batteryCapacityKwh !== null &&
    batteryCapacityKwh > 0 &&
    Number.isFinite(roundTripEfficiencyPercent) &&
    roundTripEfficiencyPercent > 0 &&
    roundTripEfficiencyPercent <= 100 &&
    Number.isFinite(minSocPercent) &&
    minSocPercent >= 0 &&
    minSocPercent < MAX_SOC_PERCENT &&
    Number.isFinite(maxChargePowerKw) &&
    maxChargePowerKw > 0 &&
    Number.isFinite(maxDischargePowerKw) &&
    maxDischargePowerKw > 0 &&
    Number.isFinite(newCapacityKw) &&
    newCapacityKw > 0 &&
    Number.isFinite(batteryLifetimeEfc) &&
    batteryLifetimeEfc > 0
      ? {
          capacityKwh: batteryCapacityKwh,
          roundTripEfficiencyPercent,
          minSocPercent,
          maxSocPercent: MAX_SOC_PERCENT,
          maxChargePowerKw,
          maxDischargePowerKw,
          allowGridCharging,
          // Physical AC export ceiling fix - the plant's own installed/
          // inverter AC export capacity is the simulated capacity itself
          // (`newCapacityKw`), never the battery's own charge/discharge
          // power rating. See `BatteryConfig.exportPowerLimitKw`'s doc
          // comment in battery-dispatch.ts.
          exportPowerLimitKw: newCapacityKw,
          // Battery Degradation Economics milestone - standard LiFePO4
          // grid-scale BESS assumptions, derived from this battery's own
          // configured DoD (MAX_SOC_PERCENT - minSocPercent). Investor
          // Lifetime Economics milestone: lifetime is now the user-editable
          // `batteryLifetimeEfc` (default `DEFAULT_BATTERY_LIFETIME_EFC`)
          // rather than the hardcoded constant - see
          // computeDegradationCostPerKwh's doc comment for why this
          // calculation is independent of capacityKwh/duration.
          degradationCostPerKwh: computeDegradationCostPerKwh(
            DEFAULT_BATTERY_CAPEX_EUR_PER_KWH,
            batteryLifetimeEfc,
            MAX_SOC_PERCENT - minSocPercent,
          ),
        }
      : null;

  const batteryInputsInvalid = batteryEnabled && batteryConfig === null;

  function resetBatteryDefaults(plantCapacityKw: number | null) {
    setBatteryEnabled(false);
    setDurationPreset("2h");
    setCustomCapacityInput("");
    setRoundTripEfficiencyInput(DEFAULT_ROUND_TRIP_EFFICIENCY_PERCENT);
    setMinSocInput(DEFAULT_MIN_SOC_PERCENT);
    setMaxChargePowerInput(plantCapacityKw !== null ? plantCapacityKw.toString() : "");
    setMaxDischargePowerInput(plantCapacityKw !== null ? plantCapacityKw.toString() : "");
    setAllowGridCharging(false);
    setBatteryLifetimeEfcInput(DEFAULT_BATTERY_LIFETIME_EFC.toString());
  }

  function handlePlantChange(id: string) {
    setPlantId(id);
    setResult(null);
    setError(null);
    const plant = plants.find((p) => p.id === id);
    const capacityKw = plant?.capacityKw ?? null;
    setNewCapacityInput(capacityKw !== null ? capacityKw.toString() : "");
    resetBatteryDefaults(capacityKw);
  }

  function handleEnableBattery(enabled: boolean) {
    setBatteryEnabled(enabled);
    if (enabled && maxChargePowerInput === "" && maxDischargePowerInput === "") {
      setMaxChargePowerInput(currentCapacityKw !== null ? currentCapacityKw.toString() : "");
      setMaxDischargePowerInput(currentCapacityKw !== null ? currentCapacityKw.toString() : "");
    }
  }

  function run() {
    if (isPending || !selectedPlant || !currentCapacityKw) {
      return;
    }

    if (!Number.isFinite(newCapacityKw) || newCapacityKw <= 0) {
      setError("Enter a valid new installed capacity greater than zero");
      return;
    }

    if (period === "custom" && (!customStart || !customEnd)) {
      setError("Custom range requires both a start and an end date");
      return;
    }

    if (batteryInputsInvalid) {
      setError("Enter valid battery parameters (capacity, efficiency, min SOC, and power all greater than zero)");
      return;
    }

    setError(null);

    startTransition(async () => {
      const outcome = await runDigitalTwinSimulation(
        selectedPlant.id,
        period,
        newCapacityKw,
        batteryConfig,
        batteryLifetimeEfc,
        customStart || undefined,
        customEnd || undefined,
      );

      if (!outcome.ok) {
        setError(outcome.error);
        setResult(null);
        return;
      }

      setResult(outcome);
    });
  }

  const metricCards = useMemo(() => {
    if (!result?.ok) return null;

    return METRICS.map((metric) => ({
      metric,
      rows: buildComparisonRows(result.current[metric.key], result.simulated[metric.key], metric.unit, metric.format),
    }));
  }, [result]);

  /**
   * Investment Summary - every field here is arithmetic on values
   * `runDigitalTwinSimulation` already returned (`result.current`/
   * `result.simulated`/`result.currentCapacityKw`/`result.newCapacityKw`);
   * nothing here re-derives a quantity the simulation didn't already
   * compute. Import reduction only makes sense for a Prosumer (a Producer's
   * import is always zero, by topology, never a simulated outcome).
   */
  const investmentSummary = useMemo(() => {
    if (!result?.ok) return null;

    const capacityIncreaseKw = result.newCapacityKw - result.currentCapacityKw;
    const capacityIncreasePercent = (result.capacityFactor - 1) * 100;
    const additionalProductionKwh = result.simulated.productionKwh - result.current.productionKwh;
    const additionalExportKwh = result.simulated.exportedKwh - result.current.exportedKwh;
    const importReductionKwh =
      result.topology === "Prosumer" ? result.current.importedKwh - result.simulated.importedKwh : null;
    const additionalRevenueEur =
      result.current.revenueEur !== null && result.simulated.revenueEur !== null
        ? result.simulated.revenueEur - result.current.revenueEur
        : null;
    const revenueIncreasePercent =
      additionalRevenueEur !== null && result.current.revenueEur !== null && result.current.revenueEur > 0
        ? (additionalRevenueEur / result.current.revenueEur) * 100
        : null;

    return {
      currentCapacityKw: result.currentCapacityKw,
      newCapacityKw: result.newCapacityKw,
      capacityIncreaseKw,
      capacityIncreasePercent,
      // Investor Lifetime Economics milestone - Row 1 (System Size). This
      // system has no concept of a real, already-installed battery anywhere
      // (batteries are hypothetical scenarios only, never a `Plant` field),
      // so "Battery increase" is always exactly the simulated battery's own
      // capacity - never a difference against a real baseline.
      simulatedBatteryCapacityKwh: result.simulatedBattery?.capacityKwh ?? null,
      batteryIncreaseKwh: result.simulatedBattery?.capacityKwh ?? null,
      additionalProductionKwh,
      additionalExportKwh,
      importReductionKwh,
      additionalRevenueEur,
      revenueIncreasePercent,
      currentAverageSellingPriceEurPerMwh: result.current.averageSellingPriceEurPerMwh,
      averageSellingPriceEurPerMwh: result.simulated.averageSellingPriceEurPerMwh,
      // Battery Digital Twin UI milestone - straight from `ReplayOutcome.battery` via `simulatedBattery`, null when the battery scenario is disabled.
      batteryThroughputKwh: result.simulatedBattery?.throughputKwh ?? null,
      batteryLossesKwh: result.simulatedBattery?.batteryLossesKwh ?? null,
    };
  }, [result]);

  /**
   * Conservative Battery Lifetime Planning Model milestone. Replaces the
   * prior naive "remainingCycles / observedEfcPerDay" linear extrapolation
   * (which could project unrealistic 15-25+ year lifetimes from a low
   * observed cycling rate, and implicitly assumed the battery retains its
   * original usable capacity forever) with a fixed, conservative planning
   * horizon: EFC utilization is still reported exactly as before (cycles
   * used/lifetime used %/cycles remaining - pure throughput/usable-capacity
   * arithmetic, unchanged), but the DISPLAYED "estimated planning life" is
   * now capped at `PLANNING_HORIZON_YEARS`, and the revenue PROJECTION comes
   * from a simple linear capacity-retention curve
   * (`capacityRetentionAtYear`) over that same fixed horizon - never an
   * unbounded extrapolation of the observed cycling rate. Annual revenue
   * displayed is still the plain, unscaled simulation-derived figure (Year-1
   * baseline); only the 10-year LIFETIME sum applies the declining
   * retention curve. Gross of Battery Wear Cost/CAPEX throughout - the
   * Investor Accounting Rule: degradation is reported separately (cycles
   * used/lifetime used %/planning life here, Battery Wear Cost in the
   * Battery KPIs diagnostic row) and never subtracted from revenue.
   */
  const batteryLifetime = useMemo(() => {
    if (!result?.ok || !result.simulatedBattery || !investmentSummary) return null;

    const { throughputKwh, usableCapacityKwh, batteryLifetimeEfc: lifetimeEfc } = result.simulatedBattery;
    const cyclesUsed = usableCapacityKwh > 0 ? throughputKwh / (2 * usableCapacityKwh) : 0;
    // EFC utilization against the configured reference cycle life - NOT a
    // claim about physical capacity degradation (that's the separate
    // capacity-retention curve below).
    const lifetimeUsedPercent = lifetimeEfc > 0 ? (cyclesUsed / lifetimeEfc) * 100 : 0;
    const remainingCycles = Math.max(0, lifetimeEfc - cyclesUsed);

    const simulationDays = periodDayCount(result.rangeStart, result.rangeEnd);
    const averageEfcPerDay = cyclesUsed > 0 ? cyclesUsed / simulationDays : 0;
    // Conservative planning cap: the EFC-implied life to reach the
    // configured reference is only ever used when it's SHORTER than the
    // 10-year performance horizon; a low (or zero) observed cycling rate
    // never produces an unrealistic 15+ year projection - it's capped at
    // the horizon instead, per the Conservative Battery Lifetime Planning
    // Model's explicit requirement.
    const efcImpliedLifeYears = averageEfcPerDay > 0 ? remainingCycles / averageEfcPerDay / 365 : Infinity;
    const planningLifeYears = Math.min(efcImpliedLifeYears, PLANNING_HORIZON_YEARS);
    const planningLifeDays = planningLifeYears * 365;

    // Year-1 baseline - the plain, unscaled simulation-derived annualized
    // revenue. Displayed as-is; only the 10-year lifetime sum below applies
    // the capacity-retention curve.
    const { additionalRevenueEur } = investmentSummary;
    const annualRevenueEur = additionalRevenueEur !== null ? (additionalRevenueEur / simulationDays) * 365 : null;
    const lifetimeRevenueEur = annualRevenueEur !== null ? sumProjectedLifetimeRevenue(annualRevenueEur) : null;

    return {
      batteryLifetimeEfc: lifetimeEfc,
      cyclesUsed,
      lifetimeUsedPercent,
      remainingCycles,
      planningLifeDays,
      annualRevenueEur,
      lifetimeRevenueEur,
    };
  }, [result, investmentSummary]);

  /**
   * Shared chart axes - Current and Simulated must always render on
   * identical energy/price scales so the visual comparison is meaningful.
   * Computed once, from the UNION of both charts' own already-aggregated
   * data, via the exact same axis math `MarketPriceChart` itself uses
   * (`computeNiceEnergyAxis`/`computeCapacityDerivedEnergyAxis`/
   * `computePriceAxisDomain`, all exported from that file) - never a new
   * scaling rule invented here.
   */
  const sharedAxes = useMemo(() => {
    if (!result?.ok) return null;

    const energyAxis =
      xAxisUnitFor(result.chartResolution) === "time"
        ? computeCapacityDerivedEnergyAxis(Math.max(result.currentCapacityKw, result.newCapacityKw))
        : computeNiceEnergyAxis(
            Math.max(
              0,
              ...result.currentChart.settlement.map((point) => point.exportedKwh ?? 0),
              ...result.simulatedChart.settlement.map((point) => point.exportedKwh ?? 0),
            ),
          );

    const combinedKnownPrices = [...result.currentChart.price, ...result.simulatedChart.price]
      .map((point) => point.price)
      .filter((price): price is number => price !== null);
    const priceAxis = computePriceAxisDomain(combinedKnownPrices);

    return { energyAxis, priceAxis };
  }, [result]);

  if (plants.length === 0) {
    return (
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <p className="text-sm text-white/60">No Huawei plants found across any organization yet.</p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h2 className="text-lg font-medium">Plant &amp; period</h2>

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm text-white/60">
            Plant
            <select
              className={selectClassName}
              value={plantId}
              onChange={(event) => handlePlantChange(event.target.value)}
            >
              {plants.map((plant) => (
                <option key={plant.id} value={plant.id} style={optionStyle}>
                  {plant.organizationName} — {plant.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-white/60">
            Period
            <select
              className={selectClassName}
              value={period}
              onChange={(event) => {
                setPeriod(event.target.value as DigitalTwinPeriod);
                setResult(null);
                setError(null);
              }}
            >
              {PERIOD_OPTIONS.map((option) => (
                <option key={option.id} value={option.id} style={optionStyle}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {period === "custom" && (
            <>
              <label className="flex flex-col gap-1 text-sm text-white/60">
                Start date
                <input
                  type="date"
                  className={inputClassName}
                  value={customStart}
                  onChange={(event) => setCustomStart(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-white/60">
                End date
                <input
                  type="date"
                  className={inputClassName}
                  value={customEnd}
                  onChange={(event) => setCustomEnd(event.target.value)}
                />
              </label>
            </>
          )}
        </div>

        {selectedPlant && (
          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-white/40">Organization</dt>
              <dd className="text-white/80">{selectedPlant.organizationName}</dd>
            </div>
            <div>
              <dt className="text-xs text-white/40">Topology</dt>
              <dd className="text-white/80">{selectedPlant.topology}</dd>
            </div>
            <div>
              <dt className="text-xs text-white/40">Vendor</dt>
              <dd className="text-white/80">{selectedPlant.vendor}</dd>
            </div>
            <div>
              <dt className="text-xs text-white/40">Current installed capacity</dt>
              <dd className="text-white/80">
                {selectedPlant.capacityKw !== null ? `${formatKw(selectedPlant.capacityKw)} kWp` : "—"}
              </dd>
            </div>
          </dl>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h2 className="text-lg font-medium">Capacity scenario</h2>

        {!currentCapacityKw ? (
          <p className="mt-3 text-sm text-red-300">
            Selected plant has no configured installed capacity - a simulation cannot be run.
          </p>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <label className="flex flex-col gap-1 text-sm text-white/60">
                New installed capacity (kWp)
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  className={inputClassName}
                  value={newCapacityInput}
                  onChange={(event) => setNewCapacityInput(event.target.value)}
                />
              </label>

              <div className="flex flex-1 min-w-[220px] flex-col gap-1 text-sm text-white/60">
                <span>
                  Slider (0 – {SLIDER_MULTIPLIER_MAX}× current, convenience only)
                </span>
                <input
                  type="range"
                  min={0}
                  max={sliderMax}
                  step={Math.max(currentCapacityKw / 100, 0.1)}
                  value={sliderValue}
                  onChange={(event) => setNewCapacityInput(event.target.value)}
                  className="accent-blue-500"
                />
              </div>

              <div className="text-sm text-white/60">
                Capacity factor
                <div className="text-lg font-semibold text-white tabular-nums">
                  {capacityFactor !== null ? `${capacityFactor.toFixed(2)}×` : "—"}
                </div>
              </div>

              <button type="button" disabled={isPending} onClick={run} className={buttonClassName}>
                {isPending ? "Running…" : "Run Simulation"}
              </button>
            </div>

            {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
          </>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Battery scenario</h2>
          <label className="flex items-center gap-2 text-sm text-white/70">
            <input
              type="checkbox"
              checked={batteryEnabled}
              onChange={(event) => handleEnableBattery(event.target.checked)}
              className="h-4 w-4 accent-blue-500"
            />
            Enable Battery
          </label>
        </div>

        {batteryEnabled && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 text-sm text-white/60">
              Battery duration
              <select
                className={selectClassName}
                value={durationPreset}
                onChange={(event) => setDurationPreset(event.target.value as BatteryDurationPreset)}
              >
                {BATTERY_DURATION_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id} style={optionStyle}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm text-white/60">
              Battery capacity (kWh){durationPreset !== "custom" ? " — auto" : ""}
              <input
                type="number"
                min={0}
                step="0.1"
                className={inputClassName}
                value={durationPreset === "custom" ? customCapacityInput : (autoCapacityKwh?.toFixed(1) ?? "")}
                readOnly={durationPreset !== "custom"}
                onChange={(event) => setCustomCapacityInput(event.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm text-white/60">
              Round-trip efficiency (%)
              <input
                type="number"
                min={0}
                max={100}
                step="0.1"
                className={inputClassName}
                value={roundTripEfficiencyInput}
                onChange={(event) => setRoundTripEfficiencyInput(event.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm text-white/60">
              Minimum SOC (%)
              <input
                type="number"
                min={0}
                max={99}
                step="1"
                className={inputClassName}
                value={minSocInput}
                onChange={(event) => setMinSocInput(event.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm text-white/60">
              Maximum charge power (kW)
              <input
                type="number"
                min={0}
                step="0.1"
                className={inputClassName}
                placeholder={currentCapacityKw !== null ? currentCapacityKw.toString() : ""}
                value={maxChargePowerInput}
                onChange={(event) => setMaxChargePowerInput(event.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm text-white/60">
              Maximum discharge power (kW)
              <input
                type="number"
                min={0}
                step="0.1"
                className={inputClassName}
                placeholder={currentCapacityKw !== null ? currentCapacityKw.toString() : ""}
                value={maxDischargePowerInput}
                onChange={(event) => setMaxDischargePowerInput(event.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm text-white/60">
              Battery lifetime (EFC)
              <input
                type="number"
                min={0}
                step="1"
                className={inputClassName}
                value={batteryLifetimeEfcInput}
                onChange={(event) => setBatteryLifetimeEfcInput(event.target.value)}
              />
            </label>

            <label className="flex items-center gap-2 text-sm text-white/60">
              <input
                type="checkbox"
                checked={allowGridCharging}
                onChange={(event) => setAllowGridCharging(event.target.checked)}
                className="h-4 w-4 accent-blue-500"
              />
              Allow Grid Charging
            </label>
          </div>
        )}
      </section>

      {result?.ok && metricCards && investmentSummary && sharedAxes && (
        <section className="space-y-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-white/40">Simulation Period</p>
              <p className="mt-0.5 text-sm font-medium text-white">
                {formatRangeLabel(result.rangeStart, result.rangeEnd)}
              </p>
            </div>
            <span className={badgeClassName}>
              {periodDayCount(result.rangeStart, result.rangeEnd)} day
              {periodDayCount(result.rangeStart, result.rangeEnd) === 1 ? "" : "s"}
            </span>
          </div>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h3 className="text-sm font-semibold text-white">Investment summary</h3>

            {/* Row 1 - System size */}
            <p className="mt-4 text-xs font-medium uppercase tracking-wider text-white/40">System size</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
              <div>
                <dt className="text-xs text-white/40">Current installed capacity</dt>
                <dd className="text-white/80">{formatKw(investmentSummary.currentCapacityKw)} kWp</dd>
              </div>
              <div>
                <dt className="text-xs text-white/40">Simulated installed capacity</dt>
                <dd className="text-white/80">{formatKw(investmentSummary.newCapacityKw)} kWp</dd>
              </div>
              <div>
                <dt className="text-xs text-white/40">Capacity increase</dt>
                <dd className={diffColorClass(investmentSummary.capacityIncreaseKw)}>
                  {formatSigned(investmentSummary.capacityIncreaseKw, formatKw)} kWp (
                  {formatPercent(investmentSummary.capacityIncreasePercent)})
                </dd>
              </div>
              <div>
                <dt className="text-xs text-white/40">Simulated battery</dt>
                <dd className="text-white/80">
                  {investmentSummary.simulatedBatteryCapacityKwh !== null
                    ? `${formatKwh(investmentSummary.simulatedBatteryCapacityKwh)} kWh`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-white/40">Battery increase</dt>
                <dd className="text-white/80">
                  {investmentSummary.batteryIncreaseKwh !== null
                    ? `${formatSigned(investmentSummary.batteryIncreaseKwh, formatKwh)} kWh`
                    : "—"}
                </dd>
              </div>
            </dl>

            {/* Row 2 - Production / export / revenue impact */}
            <p className="mt-6 text-xs font-medium uppercase tracking-wider text-white/40">
              Production, export &amp; revenue impact
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
              <div>
                <dt className="text-xs text-white/40">Additional production</dt>
                <dd className={diffColorClass(investmentSummary.additionalProductionKwh)}>
                  {formatSigned(investmentSummary.additionalProductionKwh, formatKwh)} kWh
                </dd>
              </div>
              <div>
                <dt className="text-xs text-white/40">Additional export</dt>
                <dd className={diffColorClass(investmentSummary.additionalExportKwh)}>
                  {formatSigned(investmentSummary.additionalExportKwh, formatKwh)} kWh
                </dd>
              </div>
              {investmentSummary.importReductionKwh !== null && (
                <div>
                  <dt className="text-xs text-white/40">Import reduction</dt>
                  <dd className={diffColorClass(investmentSummary.importReductionKwh)}>
                    {formatSigned(investmentSummary.importReductionKwh, formatKwh)} kWh
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-white/40">Additional revenue</dt>
                <dd
                  className={
                    investmentSummary.additionalRevenueEur !== null
                      ? diffColorClass(investmentSummary.additionalRevenueEur)
                      : "text-white/80"
                  }
                >
                  {investmentSummary.additionalRevenueEur !== null
                    ? `${formatSigned(investmentSummary.additionalRevenueEur, formatEur)} EUR`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-white/40">Revenue increase</dt>
                <dd
                  className={
                    investmentSummary.revenueIncreasePercent !== null
                      ? diffColorClass(investmentSummary.revenueIncreasePercent)
                      : "text-white/80"
                  }
                >
                  {investmentSummary.revenueIncreasePercent !== null
                    ? formatPercent(investmentSummary.revenueIncreasePercent)
                    : "—"}
                </dd>
              </div>
            </dl>
          </section>

          {batteryLifetime && (
            <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <h3 className="text-sm font-semibold text-white">Battery lifetime &amp; revenue</h3>

              {/* Battery performance - Average Selling Price (Current/Simulated), throughput, and losses moved here from Investment Summary. */}
              <p className="mt-4 text-xs font-medium uppercase tracking-wider text-white/40">Battery performance</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-white/40">Average selling price — Current</dt>
                  <dd className="text-white/80">
                    {investmentSummary.currentAverageSellingPriceEurPerMwh !== null
                      ? `${formatAsp(investmentSummary.currentAverageSellingPriceEurPerMwh)} EUR/MWh`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-white/40">Average selling price — Simulated</dt>
                  <dd className="text-white/80">
                    {investmentSummary.averageSellingPriceEurPerMwh !== null
                      ? `${formatAsp(investmentSummary.averageSellingPriceEurPerMwh)} EUR/MWh`
                      : "—"}
                  </dd>
                </div>
                {investmentSummary.batteryThroughputKwh !== null && (
                  <div>
                    <dt className="text-xs text-white/40">Battery throughput</dt>
                    <dd className="text-white/80">{formatKwh(investmentSummary.batteryThroughputKwh)} kWh</dd>
                  </div>
                )}
                {investmentSummary.batteryLossesKwh !== null && (
                  <div>
                    <dt className="text-xs text-white/40">Battery losses</dt>
                    <dd className="text-white/80">{formatKwh(investmentSummary.batteryLossesKwh)} kWh</dd>
                  </div>
                )}
              </dl>

              {/* Battery lifetime */}
              <p className="mt-6 text-xs font-medium uppercase tracking-wider text-white/40">Battery lifetime</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-white/40">Battery lifetime</dt>
                  <dd className="text-white/80">{formatEfc(batteryLifetime.batteryLifetimeEfc)} EFC</dd>
                </div>
                <div>
                  <dt className="text-xs text-white/40">Cycles used</dt>
                  <dd className="text-white/80">{formatEfc(batteryLifetime.cyclesUsed)} EFC</dd>
                </div>
                <div>
                  <dt className="text-xs text-white/40">Lifetime used</dt>
                  <dd className="text-white/80">{formatPercentPlain(batteryLifetime.lifetimeUsedPercent)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-white/40">Cycles remaining</dt>
                  <dd className="text-white/80">{formatEfc(batteryLifetime.remainingCycles)} EFC</dd>
                </div>
              </dl>

              <p className="mt-3 text-sm text-white/70">
                Estimated planning life:{" "}
                <span className="font-medium text-white">{formatRemainingLife(batteryLifetime.planningLifeDays)}</span>
              </p>

              {/* Battery revenue */}
              <p className="mt-6 text-xs font-medium uppercase tracking-wider text-white/40">Battery revenue</p>
              <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-white/40">Annual additional revenue</dt>
                  <dd className="text-white/80">
                    {batteryLifetime.annualRevenueEur !== null
                      ? `${formatEur(batteryLifetime.annualRevenueEur)} EUR/year`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-white/40">Estimated lifetime additional revenue</dt>
                  <dd className="text-white/80">
                    {batteryLifetime.lifetimeRevenueEur !== null
                      ? `${formatEur(batteryLifetime.lifetimeRevenueEur)} EUR`
                      : "—"}
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-white/40">
                Planning model: {PLANNING_HORIZON_YEARS}-year performance horizon with capacity retention modeled from 100% to{" "}
                {Math.round(END_OF_HORIZON_RETENTION_FRACTION * 100)}%. {formatEfc(batteryLifetime.batteryLifetimeEfc)} EFC is the
                configurable reference cycle life. Revenue projections decline with modeled battery capacity. This is a
                conservative planning assumption, not a manufacturer degradation guarantee.
              </p>
            </section>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {metricCards.map(({ metric, rows }) => (
              <MarketSummaryCard key={metric.key} eyebrow={metric.label} rows={rows} />
            ))}
          </div>

          {result.simulatedBattery && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <h3 className="text-sm font-semibold text-white">Battery KPIs</h3>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-7">
                <div>
                  <dt className="text-xs text-white/40">Battery capacity</dt>
                  <dd className="text-white/80">{formatKwh(result.simulatedBattery.capacityKwh)} kWh</dd>
                </div>
                <div>
                  <dt className="text-xs text-white/40">Energy charged</dt>
                  <dd className="text-white/80">{formatKwh(result.simulatedBattery.chargedEnergyKwh)} kWh</dd>
                </div>
                <div>
                  <dt className="text-xs text-white/40">— from PV</dt>
                  <dd className="text-white/80">{formatKwh(result.simulatedBattery.pvChargedEnergyKwh)} kWh</dd>
                </div>
                <div>
                  <dt className="text-xs text-white/40">— from grid</dt>
                  <dd className="text-white/80">{formatKwh(result.simulatedBattery.gridChargedEnergyKwh)} kWh</dd>
                </div>
                <div>
                  <dt className="text-xs text-white/40">Energy discharged</dt>
                  <dd className="text-white/80">{formatKwh(result.simulatedBattery.dischargedEnergyKwh)} kWh</dd>
                </div>
                <div>
                  <dt className="text-xs text-white/40">Battery throughput</dt>
                  <dd className="text-white/80">{formatKwh(result.simulatedBattery.throughputKwh)} kWh</dd>
                </div>
                <div>
                  <dt className="text-xs text-white/40">Battery losses</dt>
                  <dd className="text-white/80">{formatKwh(result.simulatedBattery.batteryLossesKwh)} kWh</dd>
                </div>
                <div>
                  <dt className="text-xs text-white/40">Peak SOC</dt>
                  <dd className="text-white/80">{formatKwh(result.simulatedBattery.peakSocKwh)} kWh</dd>
                </div>
                <div>
                  <dt className="text-xs text-white/40">Final SOC</dt>
                  <dd className="text-white/80">{formatKwh(result.simulatedBattery.finalSocKwh)} kWh</dd>
                </div>
                <div>
                  <dt className="text-xs text-white/40" title="PV energy has zero acquisition cost - never priced at market rate">
                    Avg PV Charging Acquisition Price
                  </dt>
                  <dd className="text-white/80">
                    {result.simulatedBattery.avgPvChargingAcquisitionPriceEurPerMwh !== null
                      ? `${formatAsp(result.simulatedBattery.avgPvChargingAcquisitionPriceEurPerMwh)} EUR/MWh`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-white/40">Avg Grid Charging Price</dt>
                  <dd className="text-white/80">
                    {result.simulatedBattery.avgGridChargingPriceEurPerMwh !== null
                      ? `${formatAsp(result.simulatedBattery.avgGridChargingPriceEurPerMwh)} EUR/MWh`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-white/40">Average Discharging Price</dt>
                  <dd className="text-white/80">
                    {result.simulatedBattery.avgDischargingPriceEurPerMwh !== null
                      ? `${formatAsp(result.simulatedBattery.avgDischargingPriceEurPerMwh)} EUR/MWh`
                      : "—"}
                  </dd>
                </div>
              </dl>
            </div>
          )}

          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Charts</h3>
            <span className={badgeClassName}>{resolutionBadgeLabel(result.chartResolution)}</span>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:p-4">
              <h3 className="text-sm font-semibold text-white">Current (historical)</h3>
              <div className="mt-2.5 h-[240px] sm:h-[280px]">
                <Suspense fallback={<ChartSkeleton />}>
                  <DynamicMarketPriceChart
                    series={result.currentChart.price}
                    thresholdPrice={0}
                    showThreshold={false}
                    priceMetric="averageSelling"
                    xAxisUnit={xAxisUnitFor(result.chartResolution)}
                    settlementEnergySeries={result.currentChart.settlement.map(({ intervalStart, exportedKwh }) => ({
                      intervalStart,
                      exportedKwh,
                    }))}
                    availablePvEnergySeries={result.currentChart.availablePv}
                    installedCapacityKw={result.currentCapacityKw}
                    sharedEnergyAxis={sharedAxes.energyAxis}
                    sharedPriceAxis={sharedAxes.priceAxis}
                  />
                </Suspense>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:p-4">
              <h3 className="text-sm font-semibold text-white">Simulated ({result.capacityFactor.toFixed(2)}×)</h3>
              <div className="mt-2.5 h-[240px] sm:h-[280px]">
                <Suspense fallback={<ChartSkeleton />}>
                  <DynamicMarketPriceChart
                    series={result.simulatedChart.price}
                    thresholdPrice={0}
                    showThreshold={false}
                    priceMetric="averageSelling"
                    xAxisUnit={xAxisUnitFor(result.chartResolution)}
                    settlementEnergySeries={result.simulatedChart.settlement.map(({ intervalStart, exportedKwh }) => ({
                      intervalStart,
                      exportedKwh,
                    }))}
                    installedCapacityKw={result.newCapacityKw}
                    sharedEnergyAxis={sharedAxes.energyAxis}
                    sharedPriceAxis={sharedAxes.priceAxis}
                  />
                </Suspense>
              </div>
            </section>
          </div>

          {result.simulatedBattery && (
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:p-4">
              <h3 className="text-sm font-semibold text-white">
                {result.chartResolution !== "daily"
                  ? "Battery SOC, Charge/Discharge & Market Price (Simulated)"
                  : "Battery SOC & Charge/Discharge (Simulated)"}
              </h3>
              <div className="mt-2.5 h-[240px] sm:h-[280px]">
                <Suspense fallback={<ChartSkeleton />}>
                  <DynamicBatterySocChart
                    series={result.simulatedSocChart}
                    batteryCapacityKwh={result.simulatedBattery.capacityKwh}
                    xAxisUnit={xAxisUnitFor(result.chartResolution)}
                    priceSeries={result.chartResolution !== "daily" ? result.simulatedChart.price : undefined}
                    priceAxis={result.chartResolution !== "daily" ? sharedAxes.priceAxis : undefined}
                    flowSeries={result.simulatedFlowChart}
                  />
                </Suspense>
              </div>
            </section>
          )}

          {result.diagnostics && (
            <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Battery diagnostics</h3>
                <label className="flex items-center gap-2 text-sm text-white/70">
                  <input
                    type="checkbox"
                    checked={showDiagnostics}
                    onChange={(event) => setShowDiagnostics(event.target.checked)}
                    className="h-4 w-4 accent-blue-500"
                  />
                  Show Battery Diagnostics
                </label>
              </div>

              {showDiagnostics && (
                <div className="mt-4">
                  <BatteryDiagnosticsPanel diagnostics={result.diagnostics} />
                </div>
              )}
            </section>
          )}
        </section>
      )}
    </div>
  );
}
