"use client";

import { Suspense, useState, useTransition } from "react";

import type { AutomationLabPlant } from "@/lib/admin/automation-lab-queries";
import { buildDefaultBatteryConfig } from "@/lib/digital-twin/battery-engine-report";

import { ChartSkeleton } from "@/components/charts/ChartSkeleton";
import { DynamicEntsoePriceChart } from "@/components/charts/EntsoePriceChart.dynamic";

import { getEntsoePriceOverview, type EntsoeHorizon, type EntsoePriceOverviewResult } from "./entsoe-price-actions";

type Props = {
  plants: AutomationLabPlant[];
};

const selectClassName =
  "rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/80 [color-scheme:dark]";
const optionStyle = { backgroundColor: "#0f172a", color: "#f8fafc" };

const HORIZON_OPTIONS: Array<{ id: EntsoeHorizon; label: string }> = [
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "next-3-days", label: "Next 3 days" },
  { id: "next-7-days", label: "Next 7 days" },
];

/** Same default battery shape the Digital Twin's own reference scenarios use (2-hour, 95.4% round-trip efficiency, 10-100% SOC range, PV-only charging) - a fixed, sensible default for "what would the optimizer do," not a second battery-sizing tool. */
function defaultBattery(plantCapacityKw: number) {
  return buildDefaultBatteryConfig(plantCapacityKw, 2, false);
}

/**
 * ENTSO-E Price Visualization milestone. A forward-looking day-ahead price
 * view on the same admin page as the Digital Twin's historical backtest -
 * "what will electricity cost" instead of "what did this plant do." Reuses
 * the exact same plant list `DigitalTwinPage` already fetches
 * (`listAutomationLabPlants`) - no second plant query - and the Battery
 * Dispatch Engine via `getEntsoePriceOverview` for the optimizer-decision
 * overlay, never a second dispatch calculation.
 */
export function EntsoePriceOverview({ plants }: Props) {
  const [plantId, setPlantId] = useState(plants[0]?.id ?? "");
  const [horizon, setHorizon] = useState<EntsoeHorizon>("today");
  const [showOptimizerOverlay, setShowOptimizerOverlay] = useState(true);
  const [result, setResult] = useState<EntsoePriceOverviewResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedPlant = plants.find((p) => p.id === plantId);

  function run(nextPlantId: string, nextHorizon: EntsoeHorizon, nextShowOverlay: boolean) {
    const plant = plants.find((p) => p.id === nextPlantId);
    if (!plant || !plant.capacityKw) {
      setResult({ ok: false, error: "Selected plant has no configured installed capacity" });
      return;
    }

    startTransition(async () => {
      const battery = nextShowOverlay ? defaultBattery(plant.capacityKw!) : null;
      const outcome = await getEntsoePriceOverview(nextPlantId, nextHorizon, battery);
      setResult(outcome);
    });
  }

  // Load once, on first render, for the default plant/horizon - mirrors
  // DigitalTwinForm's own "load on mount" convention rather than requiring
  // an explicit first click.
  const [hasLoaded, setHasLoaded] = useState(false);
  if (!hasLoaded && plantId) {
    setHasLoaded(true);
    run(plantId, horizon, showOptimizerOverlay);
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white/90">Day-Ahead Price Overview</h2>
          <p className="mt-0.5 text-xs text-white/50">
            Real ENTSO-E day-ahead prices, plus what the Battery Dispatch Engine would do about them.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            className={selectClassName}
            value={plantId}
            onChange={(e) => {
              setPlantId(e.target.value);
              run(e.target.value, horizon, showOptimizerOverlay);
            }}
          >
            {plants.map((plant) => (
              <option key={plant.id} value={plant.id} style={optionStyle}>
                {plant.name} ({plant.organizationName})
              </option>
            ))}
          </select>

          <select
            className={selectClassName}
            value={horizon}
            onChange={(e) => {
              const nextHorizon = e.target.value as EntsoeHorizon;
              setHorizon(nextHorizon);
              run(plantId, nextHorizon, showOptimizerOverlay);
            }}
          >
            {HORIZON_OPTIONS.map((option) => (
              <option key={option.id} value={option.id} style={optionStyle}>
                {option.label}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-1.5 text-xs text-white/70">
            <input
              type="checkbox"
              checked={showOptimizerOverlay}
              onChange={(e) => {
                setShowOptimizerOverlay(e.target.checked);
                run(plantId, horizon, e.target.checked);
              }}
            />
            Optimizer overlay
          </label>
        </div>
      </div>

      <div className="mt-4 h-80">
        {isPending && <ChartSkeleton />}

        {!isPending && result?.ok === false && <p className="text-sm text-red-400">{result.error}</p>}

        {!isPending && result?.ok === true && result.series.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-white/40">
            No ENTSO-E prices published yet for this horizon.
          </div>
        )}

        {!isPending && result?.ok === true && result.series.length > 0 && (
          <Suspense fallback={<ChartSkeleton />}>
            <DynamicEntsoePriceChart
              series={result.series}
              decisions={showOptimizerOverlay ? result.decisions : []}
              xAxisUnit={horizon === "today" || horizon === "tomorrow" ? "time" : "day"}
            />
          </Suspense>
        )}
      </div>

      {selectedPlant && result?.ok && result.decisions.length === 0 && showOptimizerOverlay && result.series.length > 0 && (
        <p className="mt-2 text-xs text-white/40">
          No optimizer decisions yet for this horizon - the Battery Dispatch Engine only has real telemetry to replay
          against once a period has actually happened.
        </p>
      )}
    </div>
  );
}
