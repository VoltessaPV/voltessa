"use client";

import { useState, useTransition } from "react";

import {
  enableNoLimitForAtlanta,
  enableZeroExportForAtlanta,
  readFusionSolarAtlantaStatus,
  type ChangeModeResult,
  type DongleChangeResult,
  type DongleStatus,
  type FailureDetail,
  type ReadStatusResult,
} from "./actions";

type PendingAction = "read-status" | "zero-export" | "no-limit" | null;

const buttonClassName =
  "rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-blue-600";

function modeIndicator(mode: string): string {
  if (mode === "Zero Export") return "🟢";
  if (mode === "No Limit") return "⚪";
  return "❓";
}

function FailurePanel({ failure, error }: { failure: FailureDetail | undefined; error: string }) {
  return (
    <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
      <p className="font-medium">Stopped: {error}</p>

      {failure && (
        <dl className="mt-3 space-y-1 text-red-300/90">
          {failure.dongle && (
            <div>
              <dt className="inline font-medium">Dongle: </dt>
              <dd className="inline">{failure.dongle}</dd>
            </div>
          )}
          <div>
            <dt className="inline font-medium">Failed step: </dt>
            <dd className="inline">{failure.step}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Playwright error: </dt>
            <dd className="inline break-all">{failure.playwrightError}</dd>
          </div>
          {failure.screenshotPath && (
            <div>
              <dt className="inline font-medium">Screenshot path: </dt>
              <dd className="inline break-all">{failure.screenshotPath}</dd>
            </div>
          )}
        </dl>
      )}

      {failure?.screenshotDataUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- a locally-generated data URL, not an optimizable remote image
        <img
          src={failure.screenshotDataUrl}
          alt={`Screenshot at failure${failure.dongle ? ` (${failure.dongle})` : ""}`}
          className="mt-3 w-full rounded-lg border border-red-500/20"
        />
      )}
    </div>
  );
}

function StatusList({ dongles }: { dongles: DongleStatus[] }) {
  if (dongles.length === 0) {
    return <p className="text-sm text-slate-400">No Smart Dongles were discovered under Atlanta.</p>;
  }

  return (
    <ul className="space-y-3">
      {dongles.map((dongle) => (
        <li key={dongle.name} className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="font-medium text-white">{dongle.name}</p>
          <p className="mt-1 text-sm text-slate-300">
            {modeIndicator(dongle.mode)} {dongle.mode}
            {dongle.online === false && <span className="ml-2 text-xs text-slate-500">(offline)</span>}
          </p>
        </li>
      ))}
    </ul>
  );
}

function ChangeReportTable({ changes }: { changes: DongleChangeResult[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-left text-sm">
        <thead className="bg-white/5 text-slate-400">
          <tr>
            <th className="px-4 py-2 font-medium">Dongle</th>
            <th className="px-4 py-2 font-medium">Before</th>
            <th className="px-4 py-2 font-medium">After</th>
            <th className="px-4 py-2 font-medium">Result</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((change) => (
            <tr key={change.name} className="border-t border-white/10">
              <td className="px-4 py-2 text-white">{change.name}</td>
              <td className="px-4 py-2 text-slate-300">{change.before}</td>
              <td className="px-4 py-2 text-slate-300">{change.after}</td>
              <td className="px-4 py-2">
                <span
                  className={
                    change.result === "Changed"
                      ? "text-emerald-400"
                      : change.result === "Skipped"
                        ? "text-slate-400"
                        : "text-red-400"
                  }
                >
                  {change.result}
                </span>
                {change.reason && <span className="ml-2 text-xs text-slate-500">({change.reason})</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExecutionLogPanel({ log }: { log: string[] }) {
  if (log.length === 0) {
    return null;
  }

  return (
    <details className="rounded-xl border border-white/10 bg-black/30">
      <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-slate-300">Execution log</summary>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap px-4 pb-4 text-xs text-slate-400">
        {log.join("\n")}
      </pre>
    </details>
  );
}

export function FusionSolarAtlantaConsole() {
  const [isPending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [statusResult, setStatusResult] = useState<ReadStatusResult | null>(null);
  const [changeResult, setChangeResult] = useState<ChangeModeResult | null>(null);

  const hasReadStatus = statusResult?.success === true;

  function runReadStatus() {
    if (isPending) {
      return;
    }

    setPendingAction("read-status");

    startTransition(async () => {
      const result = await readFusionSolarAtlantaStatus();
      setStatusResult(result);
      setPendingAction(null);
    });
  }

  function runChange(action: "zero-export" | "no-limit", send: () => Promise<ChangeModeResult>) {
    if (isPending || !hasReadStatus) {
      return;
    }

    setPendingAction(action);
    setChangeResult(null);

    startTransition(async () => {
      const result = await send();
      setChangeResult(result);
      setPendingAction(null);
    });
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={isPending} onClick={runReadStatus} className={buttonClassName}>
          {pendingAction === "read-status" ? "Reading..." : "Read Status"}
        </button>

        <button
          type="button"
          disabled={isPending || !hasReadStatus}
          onClick={() => runChange("zero-export", enableZeroExportForAtlanta)}
          className={buttonClassName}
          title={hasReadStatus ? undefined : "Read Status first"}
        >
          {pendingAction === "zero-export" ? "Working..." : "Enable Zero Export"}
        </button>

        <button
          type="button"
          disabled={isPending || !hasReadStatus}
          onClick={() => runChange("no-limit", enableNoLimitForAtlanta)}
          className={buttonClassName}
          title={hasReadStatus ? undefined : "Read Status first"}
        >
          {pendingAction === "no-limit" ? "Working..." : "Enable No Limit"}
        </button>
      </div>

      {statusResult && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Status</h2>
          <div>
            {statusResult.success ? (
              <StatusList dongles={statusResult.dongles} />
            ) : (
              <FailurePanel error={statusResult.error} failure={statusResult.failure} />
            )}
          </div>
          <ExecutionLogPanel log={statusResult.log} />
        </section>
      )}

      {changeResult && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">{changeResult.success ? "Final Report" : "Change Failed"}</h2>
          <div className="space-y-4">
            {changeResult.dongles.length > 0 && <ChangeReportTable changes={changeResult.dongles} />}
            {!changeResult.success && <FailurePanel error={changeResult.error} failure={changeResult.failure} />}
          </div>
          <ExecutionLogPanel log={changeResult.log} />
        </section>
      )}
    </div>
  );
}
