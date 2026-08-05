"use client";

import { useState, useTransition } from "react";

import type { AutomationLabPlant } from "@/lib/admin/automation-lab-queries";
import type { AutomationCatalogEntry } from "@/lib/automation/automation-catalog";
import type { AutomationType } from "@/lib/automation/manufacturer-control-adapter";

import { runAutomation, type RunAutomationResult } from "./actions";

type Props = {
  plants: AutomationLabPlant[];
  catalog: AutomationCatalogEntry[];
};

// [color-scheme:dark] + optionStyle: same fix as
// components/settings/EnergyMarketCard.tsx's selectClassName - native
// <option> popups don't inherit background-color from the <select>, so
// without this they render on the browser's default opaque white surface
// under our white option text.
const selectClassName =
  "rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/80 [color-scheme:dark]";
const optionStyle = { backgroundColor: "#0f172a", color: "#f8fafc" };

const inputClassName =
  "rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/80 placeholder:text-white/30";

const buttonClassName =
  "rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-blue-600";
const controlButtonClassName =
  "rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-red-600";

type SuccessResult = Extract<RunAutomationResult, { ok: true }>["result"];
type ResultEntry = SuccessResult & { ranAt: number; automationLabel: string; plantName: string };

function defaultParamValues(definition: AutomationCatalogEntry | undefined): Record<string, string> {
  if (!definition) {
    return {};
  }
  return Object.fromEntries(definition.parameters.map((param) => [param.name, param.defaultValue ?? ""]));
}

/**
 * The page itself renders no business logic - every automation runs
 * through `runAutomation` (`./actions.ts`), which calls only
 * `AutomationService.execute`. This component's entire job is collecting
 * plant/automation/parameter selections and displaying exactly what came
 * back - request JSON and response JSON side by side, nothing hidden, per
 * the Automation Lab spec.
 */
export function AutomationLabForm({ plants, catalog }: Props) {
  const [isPending, startTransition] = useTransition();
  const [plantId, setPlantId] = useState(plants[0]?.id ?? "");
  const [automationId, setAutomationId] = useState<AutomationType>(
    catalog[0]?.id ?? "read-inverter-status",
  );
  const [paramValues, setParamValues] = useState<Record<string, string>>(
    defaultParamValues(catalog[0]),
  );
  const [results, setResults] = useState<ResultEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const selectedPlant = plants.find((plant) => plant.id === plantId);
  const selectedAutomation = catalog.find((entry) => entry.id === automationId);

  function handlePlantChange(id: string) {
    setPlantId(id);
    setError(null);
  }

  function handleAutomationChange(id: string) {
    setAutomationId(id as AutomationType);
    setParamValues(defaultParamValues(catalog.find((entry) => entry.id === id)));
    setError(null);
  }

  function handleParamChange(name: string, value: string) {
    setParamValues((prev) => ({ ...prev, [name]: value }));
  }

  function execute() {
    if (isPending || !selectedPlant || !selectedAutomation) {
      return;
    }

    if (selectedAutomation.kind === "control") {
      const confirmed = window.confirm(
        `"${selectedAutomation.label}" sends a REAL command to ${selectedPlant.name} and can change its export behavior. Continue?`,
      );
      if (!confirmed) {
        return;
      }
    }

    setError(null);

    startTransition(async () => {
      const outcome = await runAutomation(selectedPlant.id, selectedAutomation.id, paramValues);

      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }

      setResults((prev) => [
        {
          ...outcome.result,
          ranAt: Date.now(),
          automationLabel: selectedAutomation.label,
          plantName: selectedPlant.name,
        },
        ...prev,
      ]);
    });
  }

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
        <h2 className="text-lg font-medium">Plant</h2>

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
        </div>

        {selectedPlant && (
          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <div>
              <dt className="text-xs text-white/40">Organization</dt>
              <dd className="text-white/80">{selectedPlant.organizationName}</dd>
            </div>
            <div>
              <dt className="text-xs text-white/40">Manufacturer</dt>
              <dd className="text-white/80">{selectedPlant.vendor}</dd>
            </div>
            <div>
              <dt className="text-xs text-white/40">Plant</dt>
              <dd className="text-white/80">{selectedPlant.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-white/40">Installed capacity</dt>
              <dd className="text-white/80">
                {selectedPlant.capacityKw !== null ? `${selectedPlant.capacityKw} kW` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-white/40">Topology</dt>
              <dd className="text-white/80">{selectedPlant.topology}</dd>
            </div>
            <div>
              <dt className="text-xs text-white/40">Automation status</dt>
              <dd className="text-white/80">
                {selectedPlant.automationEnabled ? "Enabled" : "Disabled"}
                {selectedPlant.currentExportMode ? ` — ${selectedPlant.currentExportMode}` : ""}
              </dd>
            </div>
          </dl>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h2 className="text-lg font-medium">Automation</h2>

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm text-white/60">
            Automation
            <select
              className={selectClassName}
              value={automationId}
              onChange={(event) => handleAutomationChange(event.target.value)}
            >
              {catalog.map((entry) => (
                <option key={entry.id} value={entry.id} style={optionStyle}>
                  {entry.kind === "control" ? "⚠ " : ""}
                  {entry.label}
                </option>
              ))}
            </select>
          </label>

          {selectedAutomation?.parameters.map((param) => (
            <label key={param.name} className="flex flex-col gap-1 text-sm text-white/60">
              {param.label}
              {param.required ? " *" : ""}
              <input
                className={inputClassName}
                type={param.type === "number" ? "number" : "text"}
                value={paramValues[param.name] ?? ""}
                placeholder={param.placeholder}
                onChange={(event) => handleParamChange(param.name, event.target.value)}
              />
            </label>
          ))}

          <button
            type="button"
            disabled={isPending || !selectedPlant}
            onClick={execute}
            className={selectedAutomation?.kind === "control" ? controlButtonClassName : buttonClassName}
          >
            {isPending ? "Running…" : "Execute"}
          </button>
        </div>

        {selectedAutomation?.kind === "control" && (
          <p className="mt-3 text-xs text-red-300">
            ⚠ This automation dispatches a real command to the selected plant. It is not a read-only
            query.
          </p>
        )}

        {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
      </section>

      {results.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-medium">Results</h2>

          {results.map((result) => (
            <div
              key={result.ranAt}
              className="rounded-2xl border border-white/10 bg-white/5 p-6 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-white/90">
                  {result.automationLabel} — {result.plantName}
                </span>
                <span
                  className={
                    result.success === true
                      ? "text-green-300"
                      : result.success === false
                        ? "text-red-300"
                        : "text-amber-300"
                  }
                >
                  {result.success === true ? "SUCCESS" : result.success === false ? "FAIL" : "ERROR"}
                </span>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-white/60 sm:grid-cols-4">
                <div>
                  <dt className="text-white/40">Execution time</dt>
                  <dd>{result.durationMs}ms</dd>
                </div>
                <div>
                  <dt className="text-white/40">Manufacturer</dt>
                  <dd>{result.vendor}</dd>
                </div>
                <div>
                  <dt className="text-white/40">Adapter</dt>
                  <dd>{result.adapter}</dd>
                </div>
                <div>
                  <dt className="text-white/40">HTTP status</dt>
                  <dd>{result.httpStatus ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-white/40">Vendor status</dt>
                  <dd>{result.vendorStatusCode ?? "—"}</dd>
                </div>
                <div className="col-span-2 sm:col-span-2">
                  <dt className="text-white/40">Warnings</dt>
                  <dd>{result.warnings.length > 0 ? result.warnings.join("; ") : "—"}</dd>
                </div>
                <div className="col-span-2 sm:col-span-4">
                  <dt className="text-white/40">Errors</dt>
                  <dd>{result.errors.length > 0 ? result.errors.join("; ") : "—"}</dd>
                </div>
              </dl>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-white/40">Request</p>
                  <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/40 p-3 text-white/70">
                    {JSON.stringify(result.requestBody, null, 2)}
                  </pre>
                </div>
                <div>
                  <p className="text-white/40">Response</p>
                  <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/40 p-3 text-white/70">
                    {JSON.stringify(result.responseBody, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
