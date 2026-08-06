"use client";

import { Suspense, useMemo, useState, useTransition } from "react";

import type { AutomationLabPlant } from "@/lib/admin/automation-lab-queries";

import { ChartSkeleton } from "@/components/charts/ChartSkeleton";
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

const PERIOD_OPTIONS: Array<{ id: DigitalTwinPeriod; label: string }> = [
  { id: "previous-day", label: "Previous day" },
  { id: "previous-week", label: "Previous week" },
  { id: "previous-month", label: "Previous month" },
  { id: "custom", label: "Custom range" },
];

const SLIDER_MULTIPLIER_MAX = 5;

function formatKwh(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
}

function formatEur(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function formatSignedKwh(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatKwh(value)}`;
}

function formatSignedEur(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatEur(value)}`;
}

function diffColorClass(diff: number): string {
  if (diff > 0) return "text-emerald-400";
  if (diff < 0) return "text-red-400";
  return "text-slate-400";
}

type MetricSpec = {
  key: "productionKwh" | "importedKwh" | "exportedKwh" | "selfConsumptionKwh" | "revenueEur";
  label: string;
  unit: string;
  format: (value: number) => string;
  formatSigned: (value: number) => string;
};

const METRICS: MetricSpec[] = [
  { key: "productionKwh", label: "Production", unit: "kWh", format: formatKwh, formatSigned: formatSignedKwh },
  { key: "importedKwh", label: "Import", unit: "kWh", format: formatKwh, formatSigned: formatSignedKwh },
  { key: "exportedKwh", label: "Export", unit: "kWh", format: formatKwh, formatSigned: formatSignedKwh },
  {
    key: "selfConsumptionKwh",
    label: "Self-consumption",
    unit: "kWh",
    format: formatKwh,
    formatSigned: formatSignedKwh,
  },
  { key: "revenueEur", label: "Revenue", unit: "EUR", format: formatEur, formatSigned: formatSignedEur },
];

function formatRangeLabel(start: Date, end: Date): string {
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", dateStyle: "medium" });
  const inclusiveEnd = new Date(end.getTime() - 1);
  return `${formatter.format(start)} – ${formatter.format(inclusiveEnd)}`;
}

/**
 * The page renders no business logic - every field here either collects an
 * input (plant, period, hypothetical capacity) or displays exactly what
 * `runDigitalTwinSimulation` (`./actions.ts`) returned. The numeric
 * capacity input is the source of truth (per spec); the slider is a
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

  const metricRows = useMemo(() => {
    if (!result?.ok) return null;

    return METRICS.map((metric) => {
      const currentValue = result.current[metric.key];
      const simulatedValue = result.simulated[metric.key];
      const diff = simulatedValue !== null && currentValue !== null ? simulatedValue - currentValue : null;

      const rows: MarketSummaryCardRow[] = [
        { label: "Current", value: currentValue !== null ? metric.format(currentValue) : "—" },
      ];
      if (diff !== null) {
        rows.push({ label: "Difference", value: metric.formatSigned(diff), valueColorClass: diffColorClass(diff) });
      }

      return {
        metric,
        value: simulatedValue !== null ? metric.format(simulatedValue) : "—",
        rows,
      };
    });
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
                {selectedPlant.capacityKw !== null ? `${selectedPlant.capacityKw} kWp` : "—"}
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

      {result?.ok && metricRows && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Results</h2>
            <p className="text-xs text-white/40">{formatRangeLabel(result.rangeStart, result.rangeEnd)}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {metricRows.map(({ metric, value, rows }) => (
              <MarketSummaryCard key={metric.key} eyebrow={metric.label} value={value} valueUnit={metric.unit} rows={rows} />
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:p-4">
              <h3 className="text-sm font-semibold text-white">Current (historical)</h3>
              <div className="mt-2.5 h-[240px] sm:h-[280px]">
                <Suspense fallback={<ChartSkeleton />}>
                  <DynamicMarketPriceChart
                    series={result.priceSeries}
                    thresholdPrice={0}
                    showThreshold={false}
                    priceMetric="averageSelling"
                    xAxisUnit={
                      result.rangeEnd.getTime() - result.rangeStart.getTime() <= 25 * 60 * 60 * 1000 ? "time" : "day"
                    }
                    settlementEnergySeries={result.currentSettlementSeries.map(({ intervalStart, exportedKwh }) => ({
                      intervalStart,
                      exportedKwh,
                    }))}
                    installedCapacityKw={result.currentCapacityKw}
                  />
                </Suspense>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:p-4">
              <h3 className="text-sm font-semibold text-white">Simulated ({result.capacityFactor.toFixed(2)}×)</h3>
              <div className="mt-2.5 h-[240px] sm:h-[280px]">
                <Suspense fallback={<ChartSkeleton />}>
                  <DynamicMarketPriceChart
                    series={result.priceSeries}
                    thresholdPrice={0}
                    showThreshold={false}
                    priceMetric="averageSelling"
                    xAxisUnit={
                      result.rangeEnd.getTime() - result.rangeStart.getTime() <= 25 * 60 * 60 * 1000 ? "time" : "day"
                    }
                    settlementEnergySeries={result.simulatedSettlementSeries.map(({ intervalStart, exportedKwh }) => ({
                      intervalStart,
                      exportedKwh,
                    }))}
                    installedCapacityKw={result.newCapacityKw}
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
