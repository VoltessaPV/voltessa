"use client";

import { Suspense, useMemo, useState, useTransition } from "react";

import type { AutomationLabPlant } from "@/lib/admin/automation-lab-queries";
import type { ChartResolution } from "@/lib/market-price/chart-aggregation";

import { ChartSkeleton } from "@/components/charts/ChartSkeleton";
import {
  computeCapacityDerivedEnergyAxis,
  computeNiceEnergyAxis,
  computePriceAxisDomain,
} from "@/components/market/MarketPriceChart";
import { DynamicMarketPriceChart } from "@/components/market/MarketPriceChart.dynamic";
import { MarketSummaryCard, type MarketSummaryCardRow } from "@/components/market/MarketSummaryCard";

import { runDigitalTwinSimulation, type DigitalTwinPeriod, type DigitalTwinResult } from "./actions";

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

  function handlePlantChange(id: string) {
    setPlantId(id);
    setResult(null);
    setError(null);
    const plant = plants.find((p) => p.id === id);
    setNewCapacityInput(plant?.capacityKw !== null && plant?.capacityKw !== undefined ? plant.capacityKw.toString() : "");
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

    setError(null);

    startTransition(async () => {
      const outcome = await runDigitalTwinSimulation(
        selectedPlant.id,
        period,
        newCapacityKw,
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
      additionalProductionKwh,
      additionalExportKwh,
      importReductionKwh,
      additionalRevenueEur,
      revenueIncreasePercent,
      averageSellingPriceEurPerMwh: result.simulated.averageSellingPriceEurPerMwh,
    };
  }, [result]);

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
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
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
              <div>
                <dt className="text-xs text-white/40">Average Selling Price</dt>
                <dd className="text-white/80">
                  {investmentSummary.averageSellingPriceEurPerMwh !== null
                    ? `${formatAsp(investmentSummary.averageSellingPriceEurPerMwh)} EUR/MWh`
                    : "—"}
                </dd>
              </div>
            </dl>
          </section>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {metricCards.map(({ metric, rows }) => (
              <MarketSummaryCard key={metric.key} eyebrow={metric.label} rows={rows} />
            ))}
          </div>

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
        </section>
      )}
    </div>
  );
}
