"use client";

import { useMemo, useRef, useState, useTransition } from "react";

import type { ReferencePlant } from "@/lib/pv-simulator/reference-plant";

import {
  exportSimulation,
  runSimulationPreview,
  type SimulationPreview,
} from "./actions";

type Props = { referencePlants: ReferencePlant[] };

const selectClassName =
  "rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/80 [color-scheme:dark]";
const optionStyle = { backgroundColor: "#0f172a", color: "#f8fafc" };
const inputClassName =
  "rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/80 [color-scheme:dark] placeholder:text-white/30";
const primaryButton =
  "rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-blue-600";
const secondaryButton =
  "rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-50";
const chipButton =
  "rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/70 transition hover:border-white/30 hover:text-white";
const card = "rounded-2xl border border-white/10 bg-white/5 p-6";

const CAPACITY_PRESETS = [100, 250, 500, 750, 1000];

type Mode = "self_consumption_only" | "self_consumption_plus_export";

function decodeBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) view[i] = binary.charCodeAt(i);
  return buffer;
}

export function PvSimulatorForm({ referencePlants }: Props) {
  const [isPending, startTransition] = useTransition();
  const [isDownloading, setIsDownloading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const defaultPlantId = useMemo(() => {
    const cho = referencePlants.find((p) => /chomak|чомаков/i.test(p.name) || /chomak/i.test(p.organizationName));
    return cho?.id ?? referencePlants[0]?.id ?? "";
  }, [referencePlants]);

  const [referencePlantId, setReferencePlantId] = useState(defaultPlantId);
  const referencePlant = referencePlants.find((p) => p.id === referencePlantId);

  const [capacity, setCapacity] = useState("500");
  const [mode, setMode] = useState<Mode>("self_consumption_only");
  const [unitMode, setUnitMode] = useState<"kwh_interval" | "kw_average">("kwh_interval");
  const [restrictStart, setRestrictStart] = useState("");
  const [restrictEnd, setRestrictEnd] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);

  const [preview, setPreview] = useState<SimulationPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const capacityNum = Number(capacity);
  const capacityValid = Number.isFinite(capacityNum) && capacityNum > 0;
  const canRun = referencePlantId !== "" && capacityValid && !!fileName;

  function buildFormData(): FormData | null {
    const file = fileRef.current?.files?.[0];
    if (!file) return null;
    const fd = new FormData();
    fd.set("file", file);
    fd.set("referencePlantId", referencePlantId);
    fd.set("capacityKwp", capacity);
    fd.set("mode", mode);
    fd.set("unitMode", unitMode);
    if (restrictStart) fd.set("restrictStart", restrictStart);
    if (restrictEnd) fd.set("restrictEnd", restrictEnd);
    return fd;
  }

  function handleRun() {
    if (!canRun || isPending) return;
    const fd = buildFormData();
    if (!fd) {
      setError("Select the load-profile Excel file.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await runSimulationPreview(fd);
      if (!result.ok) {
        setPreview(null);
        setError(result.error);
        return;
      }
      setPreview(result.preview);
    });
  }

  async function handleDownload(format: "csv" | "xlsx") {
    if (!canRun || isDownloading) return;
    const fd = buildFormData();
    if (!fd) return;
    fd.set("format", format);
    setError(null);
    setIsDownloading(true);
    try {
      const result = await exportSimulation(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const blob = new Blob([decodeBase64ToArrayBuffer(result.base64)], { type: result.mimeType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("The download could not be generated. Try restricting the date range.");
    } finally {
      setIsDownloading(false);
    }
  }

  if (referencePlants.length === 0) {
    return (
      <section className={card}>
        <p className="text-sm text-white/60">
          No PV plants with a configured installed capacity are available as a reference yet.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className={card}>
        <h2 className="text-lg font-medium text-white">Inputs</h2>

        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-white/60">
            Customer load profile (.xlsx)
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              className={`${inputClassName} file:mr-3 file:rounded file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-white/80`}
              onChange={(e) => {
                setFileName(e.target.files?.[0]?.name ?? null);
                setPreview(null);
              }}
            />
            <span className="text-xs text-white/40">
              15-minute interval consumption. Pivot layout (a row per day, 96 interval-end time
              columns) as produced by the utility export.
            </span>
          </label>

          <label className="flex flex-col gap-1 text-sm text-white/60">
            Reference PV plant
            <select
              className={selectClassName}
              value={referencePlantId}
              onChange={(e) => {
                setReferencePlantId(e.target.value);
                setPreview(null);
              }}
            >
              {referencePlants.map((p) => (
                <option key={p.id} value={p.id} style={optionStyle}>
                  {p.organizationName} — {p.name} ({p.referenceCapacityKwp} kWp)
                </option>
              ))}
            </select>
            {referencePlant && (
              <span className="text-xs text-white/40">
                Reference capacity {referencePlant.referenceCapacityKwp} kWp · timezone{" "}
                {referencePlant.timezone}. Production scaled by target ÷ reference.
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1 text-sm text-white/60">
            PV capacity (kWp)
            <input
              type="number"
              min="0"
              step="1"
              className={inputClassName}
              value={capacity}
              onChange={(e) => {
                setCapacity(e.target.value);
                setPreview(null);
              }}
            />
            <span className="mt-1 flex flex-wrap gap-1.5">
              {CAPACITY_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={chipButton}
                  onClick={() => {
                    setCapacity(String(c));
                    setPreview(null);
                  }}
                >
                  {c}
                </button>
              ))}
            </span>
            {!capacityValid && <span className="text-xs text-amber-300">Enter a value greater than 0.</span>}
          </label>

          <div className="flex flex-col gap-1 text-sm text-white/60">
            Load profile values are
            <select
              className={selectClassName}
              value={unitMode}
              onChange={(e) => {
                setUnitMode(e.target.value as "kwh_interval" | "kw_average");
                setPreview(null);
              }}
            >
              <option value="kwh_interval" style={optionStyle}>
                Interval energy — kWh per 15 minutes (default)
              </option>
              <option value="kw_average" style={optionStyle}>
                Average power — kW (converted ×0.25 to kWh/interval)
              </option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5 text-sm text-white/60">
            Simulation mode
            <label className="flex items-center gap-2 text-white/80">
              <input
                type="radio"
                name="mode"
                className="[color-scheme:dark]"
                checked={mode === "self_consumption_only"}
                onChange={() => {
                  setMode("self_consumption_only");
                  setPreview(null);
                }}
              />
              Self-consumption only — surplus PV is curtailed, grid export = 0
            </label>
            <label className="flex items-center gap-2 text-white/80">
              <input
                type="radio"
                name="mode"
                className="[color-scheme:dark]"
                checked={mode === "self_consumption_plus_export"}
                onChange={() => {
                  setMode("self_consumption_plus_export");
                  setPreview(null);
                }}
              />
              Self-consumption + export — surplus PV becomes grid export
            </label>
          </div>

          <div className="flex flex-col gap-1 text-sm text-white/60">
            Restrict period (optional)
            <div className="flex items-center gap-2">
              <input
                type="date"
                className={inputClassName}
                value={restrictStart}
                onChange={(e) => {
                  setRestrictStart(e.target.value);
                  setPreview(null);
                }}
              />
              <span className="text-white/30">→</span>
              <input
                type="date"
                className={inputClassName}
                value={restrictEnd}
                onChange={(e) => {
                  setRestrictEnd(e.target.value);
                  setPreview(null);
                }}
              />
            </div>
            <span className="text-xs text-white/40">
              Blank = the full period present in the uploaded profile. Dates are the reference plant
              timezone; the end date is inclusive.
            </span>
          </div>
        </div>
      </section>

      <section className={card}>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={primaryButton} disabled={!canRun || isPending} onClick={handleRun}>
            {isPending ? "Running simulation…" : "Run simulation"}
          </button>
          <button
            type="button"
            className={secondaryButton}
            disabled={!preview || isDownloading}
            onClick={() => handleDownload("csv")}
          >
            {isDownloading ? "Preparing…" : "Download CSV (15-min detail)"}
          </button>
          <button
            type="button"
            className={secondaryButton}
            disabled={!preview || isDownloading}
            onClick={() => handleDownload("xlsx")}
          >
            {isDownloading ? "Preparing…" : "Download XLSX (4 sheets)"}
          </button>
        </div>

        {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

        {preview && <PreviewPanel preview={preview} />}
      </section>
    </div>
  );
}

function PreviewPanel({ preview }: { preview: SimulationPreview }) {
  const s = preview.summary;
  const partial = preview.quality.noReferencePvIntervals > 0;
  const rows: Array<[string, string]> = [
    ["Simulation period", preview.periodLabel],
    ["Total consumption", `${s.totalConsumptionKwh} kWh`],
    ["Grid import without PV (whole period)", `${s.gridImportWithoutPvKwh} kWh`],
    ["Grid import with PV (whole period)", `${s.gridImportWithPvKwh} kWh`],
    [
      "Grid import reduction (whole period)",
      `${s.gridImportReductionKwh} kWh (${s.gridImportReductionRate})`,
    ],
    ["PV generation", `${s.pvGenerationKwh} kWh`],
    ["Self-consumed PV", `${s.selfConsumedPvKwh} kWh`],
    ["Exported PV", `${s.exportedPvKwh} kWh`],
    ["Curtailed PV", `${s.curtailedPvKwh} kWh`],
    ["Solar coverage (whole period)", s.solarCoverageRate],
    ["Self-consumption rate", s.selfConsumptionRate],
    ...(partial
      ? ([
          ["Solar coverage (covered days only)", s.coveredSolarCoverageRate],
          ["Grid import reduction (covered days only)", s.coveredGridImportReductionRate],
        ] as Array<[string, string]>)
      : []),
  ];

  return (
    <div className="mt-6 space-y-5">
      <div className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div className="col-span-full text-xs text-white/40">
          {preview.referenceOrganizationName} — {preview.referencePlantName} scaled from{" "}
          {preview.referenceCapacityKwp} kWp to {preview.targetCapacityKwp} kWp · {preview.modeLabel}
        </div>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-white/40">{k}</dt>
            <dd className="text-white/85">{v}</dd>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-white/70">
          {preview.quality.totalIntervals} intervals
        </span>
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-1 ${
            preview.quality.missingLoadIntervals === 0
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-amber-500/30 bg-amber-500/10 text-amber-300"
          }`}
        >
          missing consumption: {preview.quality.missingLoadIntervals}
        </span>
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-1 ${
            preview.quality.noReferencePvIntervals === 0
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-amber-500/30 bg-amber-500/10 text-amber-300"
          }`}
        >
          no reference PV: {preview.quality.noReferencePvIntervals} interval(s) ·{" "}
          {preview.quality.daysWithoutAnyReferencePv} day(s) · coverage{" "}
          {preview.quality.referencePvCoverageRate}
        </span>
        {preview.quality.dstAmbiguousIntervals > 0 && (
          <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-300">
            DST-ambiguous (excluded): {preview.quality.dstAmbiguousIntervals}
          </span>
        )}
      </div>

      {preview.warnings.length > 0 && (
        <ul className="space-y-1 text-xs text-amber-300">
          {preview.warnings.slice(0, 8).map((w, i) => (
            <li key={i}>• {w}</li>
          ))}
          {preview.warnings.length > 8 && (
            <li className="text-white/40">…and {preview.warnings.length - 8} more (see the XLSX Summary sheet).</li>
          )}
        </ul>
      )}

      <div>
        <h3 className="mb-2 text-sm font-medium text-white/80">Monthly overview</h3>
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-white/5 text-white/50">
              <tr>
                {[
                  "Month",
                  "Consumption",
                  "Import w/o PV",
                  "Import w/ PV",
                  "PV gen",
                  "PV used",
                  "PV curtailed",
                  "Export",
                  "Self-cons.",
                  "Solar cov.",
                ].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-white/75">
              {preview.monthly.map((m) => (
                <MonthlyTr key={m.month} row={m} />
              ))}
              <MonthlyTr row={preview.monthlyTotal} total />
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-white/80">
          15-minute detail (first {preview.previewRows.length} of {preview.detailRowCount})
        </h3>
        <div className="max-h-96 overflow-auto rounded-lg border border-white/10">
          <table className="min-w-full text-left text-xs">
            <thead className="sticky top-0 bg-[#0f172a] text-white/50">
              <tr>
                {preview.detailColumns.map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-white/70">
              {preview.previewRows.map((row, i) => (
                <tr key={i} className="border-t border-white/5">
                  {row.map((cell, j) => (
                    <td key={j} className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                      {cell === "" ? <span className="text-white/25">—</span> : cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {preview.truncated && (
          <p className="mt-2 text-xs text-white/40">
            Download the CSV or XLSX for every interval, the hourly profile, and the TOTAL row.
          </p>
        )}
      </div>
    </div>
  );
}

function MonthlyTr({
  row,
  total = false,
}: {
  row: SimulationPreview["monthlyTotal"];
  total?: boolean;
}) {
  const cls = total
    ? "border-t-2 border-white/20 bg-white/5 font-semibold text-white"
    : "border-t border-white/5";
  const cell = (v: string) => (v === "" ? <span className="text-white/25">—</span> : v);
  return (
    <tr className={cls}>
      <td className="whitespace-nowrap px-3 py-1.5">{row.month}</td>
      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{cell(row.consumptionKwh)}</td>
      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{cell(row.gridImportWithoutPvKwh)}</td>
      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{cell(row.gridImportWithPvKwh)}</td>
      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{cell(row.pvGenerationKwh)}</td>
      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{cell(row.pvUsedOnSiteKwh)}</td>
      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{cell(row.pvCurtailedKwh)}</td>
      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{cell(row.gridExportKwh)}</td>
      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{cell(row.selfConsumptionRate)}</td>
      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{cell(row.solarCoverageRate)}</td>
    </tr>
  );
}
