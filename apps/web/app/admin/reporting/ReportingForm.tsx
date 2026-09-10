"use client";

import { useMemo, useState, useTransition } from "react";

import type { ReportingPlant } from "@/lib/admin/reporting-queries";
import { REPORT_METRICS, type MetricGroup, type MetricKey } from "@/lib/reporting/metrics";
import type { ExportFormat } from "@/lib/reporting/report-request";

import {
  exportReport,
  generateReportPreview,
  type ReportPreview,
} from "./actions";

type Props = {
  plants: ReportingPlant[];
  maxRangeDays: number;
};

// Same dark-mode <select>/<option> and <input> fix as AutomationLabForm.tsx.
const selectClassName =
  "rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/80 [color-scheme:dark]";
const optionStyle = { backgroundColor: "#0f172a", color: "#f8fafc" };
const inputClassName =
  "rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/80 [color-scheme:dark]";
const primaryButton =
  "rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-blue-600";
const secondaryButton =
  "rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-50";
const cardClassName = "rounded-2xl border border-white/10 bg-white/5 p-6";

const GROUP_LABELS: Record<MetricGroup, string> = {
  energy: "Energy",
  financial: "Financial",
};

const ALL_METRIC_KEYS = REPORT_METRICS.map((metric) => metric.key);

function localInputValue(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function defaultRange(timeZone: string): { start: string; end: string } {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { start: localInputValue(weekAgo, timeZone), end: localInputValue(now, timeZone) };
}

function decodeBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) {
    view[i] = binary.charCodeAt(i);
  }
  return buffer;
}

export function ReportingForm({ plants, maxRangeDays }: Props) {
  const [isPending, startTransition] = useTransition();
  const [isDownloading, setIsDownloading] = useState(false);

  const [plantId, setPlantId] = useState(plants[0]?.id ?? "");
  const selectedPlant = useMemo(
    () => plants.find((plant) => plant.id === plantId),
    [plants, plantId],
  );
  const timeZone = selectedPlant?.timezone ?? "Europe/Sofia";

  const [datesTouched, setDatesTouched] = useState(false);
  const [range, setRange] = useState(() => defaultRange(timeZone));

  const [selectedMetrics, setSelectedMetrics] = useState<Set<MetricKey>>(
    () => new Set(ALL_METRIC_KEYS),
  );

  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handlePlantChange(id: string) {
    setPlantId(id);
    setError(null);
    setPreview(null);
    const nextPlant = plants.find((plant) => plant.id === id);
    if (nextPlant && !datesTouched) {
      setRange(defaultRange(nextPlant.timezone));
    }
  }

  function toggleMetric(key: MetricKey) {
    setSelectedMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
    setPreview(null);
  }

  const orderedSelected = ALL_METRIC_KEYS.filter((key) => selectedMetrics.has(key));
  const canGenerate =
    plantId !== "" && range.start !== "" && range.end !== "" && orderedSelected.length > 0;

  function baseRequest(format: ExportFormat) {
    return {
      plantId,
      start: range.start,
      end: range.end,
      metrics: orderedSelected,
      format,
    };
  }

  function handleGenerate() {
    if (!canGenerate || isPending) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await generateReportPreview(baseRequest("csv"));
      if (!result.ok) {
        setPreview(null);
        setError(result.error);
        return;
      }
      setPreview(result.preview);
    });
  }

  async function handleDownload(format: ExportFormat) {
    if (!canGenerate || isDownloading) {
      return;
    }
    setError(null);
    setIsDownloading(true);
    try {
      const result = await exportReport(baseRequest(format));
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
      setError("The download could not be generated. Try a shorter period.");
    } finally {
      setIsDownloading(false);
    }
  }

  if (plants.length === 0) {
    return (
      <section className={cardClassName}>
        <p className="text-sm text-white/60">
          No plants with telemetry are connected across any organization yet.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className={cardClassName}>
        <h2 className="text-lg font-medium text-white">Report</h2>

        <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
            Start ({timeZone})
            <input
              type="datetime-local"
              className={inputClassName}
              value={range.start}
              onChange={(event) => {
                setDatesTouched(true);
                setRange((prev) => ({ ...prev, start: event.target.value }));
                setPreview(null);
              }}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-white/60">
            End ({timeZone})
            <input
              type="datetime-local"
              className={inputClassName}
              value={range.end}
              onChange={(event) => {
                setDatesTouched(true);
                setRange((prev) => ({ ...prev, end: event.target.value }));
                setPreview(null);
              }}
            />
          </label>

          <div className="flex flex-col gap-1 text-sm text-white/60">
            Interval
            <span className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/50">
              15 minutes
            </span>
          </div>
        </div>

        <p className="mt-3 text-xs text-white/40">
          Times are the plant timezone ({timeZone}). Range aligns to the 15-minute grid; maximum{" "}
          {maxRangeDays} days.
        </p>
      </section>

      <section className={cardClassName}>
        <h2 className="text-lg font-medium text-white">Metrics</h2>
        <div className="mt-4 grid gap-6 sm:grid-cols-2">
          {(["energy", "financial"] as const).map((group) => (
            <fieldset key={group} className="space-y-2">
              <legend className="text-xs font-medium uppercase tracking-wider text-white/40">
                {GROUP_LABELS[group]}
              </legend>
              {REPORT_METRICS.filter((metric) => metric.group === group).map((metric) => (
                <label
                  key={metric.key}
                  className="flex cursor-pointer items-center gap-2.5 text-sm text-white/80"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-white/20 bg-white/5 [color-scheme:dark]"
                    checked={selectedMetrics.has(metric.key)}
                    onChange={() => toggleMetric(metric.key)}
                  />
                  {metric.label}
                  <span className="text-white/40">
                    (
                    {metric.group === "financial" && preview
                      ? metric.unit.replace("EUR", preview.currency)
                      : metric.unit}
                    )
                  </span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        {orderedSelected.length === 0 && (
          <p className="mt-3 text-xs text-amber-300">Select at least one metric.</p>
        )}
      </section>

      <section className={cardClassName}>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={primaryButton}
            disabled={!canGenerate || isPending}
            onClick={handleGenerate}
          >
            {isPending ? "Generating…" : "Generate report"}
          </button>

          <button
            type="button"
            className={secondaryButton}
            disabled={!preview || isDownloading}
            onClick={() => handleDownload("csv")}
          >
            {isDownloading ? "Preparing…" : "Download CSV"}
          </button>
          <button
            type="button"
            className={secondaryButton}
            disabled={!preview || isDownloading}
            onClick={() => handleDownload("xlsx")}
          >
            {isDownloading ? "Preparing…" : "Download XLSX"}
          </button>
        </div>

        {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

        {preview && (
          <div className="mt-6 space-y-5">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
              <div>
                <dt className="text-xs text-white/40">Plant</dt>
                <dd className="text-white/80">{preview.plantName}</dd>
              </div>
              <div>
                <dt className="text-xs text-white/40">Organization</dt>
                <dd className="text-white/80">{preview.organizationName}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-white/40">Period</dt>
                <dd className="text-white/80">{preview.periodLabel}</dd>
              </div>
              <div>
                <dt className="text-xs text-white/40">Intervals</dt>
                <dd className="text-white/80">{preview.rowCount}</dd>
              </div>
              <div>
                <dt className="text-xs text-white/40">Selected metrics</dt>
                <dd className="text-white/80">{preview.metrics.length}</dd>
              </div>
              {preview.revenue.available && preview.metrics.includes("revenue") && (
                <div>
                  <dt className="text-xs text-white/40">Total revenue</dt>
                  <dd className="text-white/80">
                    {preview.revenue.revenueEur.toFixed(2)} {preview.currency}
                  </dd>
                </div>
              )}
              {preview.revenue.available && preview.metrics.includes("gridExport") && (
                <div>
                  <dt className="text-xs text-white/40">Total export</dt>
                  <dd className="text-white/80">{preview.revenue.exportedKwh.toFixed(2)} kWh</dd>
                </div>
              )}
              {preview.revenue.available &&
                preview.revenue.averagePriceEurPerMwh !== null &&
                preview.metrics.includes("price") && (
                  <div>
                    <dt className="text-xs text-white/40">Avg price (weighted)</dt>
                    <dd className="text-white/80">
                      {preview.revenue.averagePriceEurPerMwh.toFixed(2)} {preview.currency}/MWh
                    </dd>
                  </div>
                )}
            </dl>

            <div className="flex flex-wrap gap-2 text-xs">
              {preview.completeness.map((entry) => {
                const complete = entry.withData === entry.total;
                return (
                  <span
                    key={entry.metric}
                    className={`inline-flex items-center rounded-full border px-2.5 py-1 ${
                      complete
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                        : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                    }`}
                  >
                    {entry.label}: {entry.withData}/{entry.total}
                  </span>
                );
              })}
            </div>

            {preview.priceImportPartial && (
              <p className="text-xs text-amber-300">
                The most recent market-price import is partial — some Price/Revenue intervals may be
                blank.
              </p>
            )}

            <div className="overflow-x-auto rounded-lg border border-white/10">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-white/5 text-white/50">
                  <tr>
                    {preview.columns.map((column) => (
                      <th key={column.key} className="whitespace-nowrap px-3 py-2 font-medium">
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-white/75">
                  {preview.previewRows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-t border-white/5">
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex} className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                          {cell === "" ? <span className="text-white/25">—</span> : cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="border-t-2 border-white/20 bg-white/5 font-semibold text-white">
                    {preview.totalRow.map((cell, cellIndex) => (
                      <td key={cellIndex} className="whitespace-nowrap px-3 py-2 tabular-nums">
                        {cell === "" ? <span className="text-white/25">—</span> : cell}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            {preview.truncated && (
              <p className="text-xs text-white/40">
                Preview shows the first {preview.previewRows.length} of {preview.rowCount} intervals.
                The download contains every interval plus the TOTAL row.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
