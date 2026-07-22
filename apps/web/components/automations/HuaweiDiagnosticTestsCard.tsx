"use client";

import { useState, useTransition } from "react";

import { runHuaweiDiagnosticTest } from "@/app/(platform)/automations/actions";
import type {
  DiagnosticTarget,
  DiagnosticTestResult,
} from "@/lib/fusionsolar/diagnostic-tests";

type Props = {
  targets: DiagnosticTarget[];
  definitions: Array<{ id: string; label: string }>;
};

type ResultEntry = DiagnosticTestResult & { ranAt: number };

const selectClassName =
  "rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/80";

const buttonClassName =
  "rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-blue-600";

export function HuaweiDiagnosticTestsCard({ targets, definitions }: Props) {
  const [isPending, startTransition] = useTransition();
  const [testId, setTestId] = useState(definitions[0]?.id ?? "");
  const [targetKey, setTargetKey] = useState(targets[0]?.key ?? "");
  const [results, setResults] = useState<ResultEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  function execute() {
    if (isPending || !testId || !targetKey) {
      return;
    }

    setError(null);

    startTransition(async () => {
      const outcome = await runHuaweiDiagnosticTest(testId, targetKey);

      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }

      setResults((prev) => [{ ...outcome.result, ranAt: Date.now() }, ...prev]);
    });
  }

  const hasSelection = definitions.length > 0 && targets.length > 0;

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <h2 className="text-lg font-medium">Huawei Diagnostic Tests</h2>

      <p className="mt-2 text-sm text-white/60">
        Engineering diagnostics only. Pick a test and a target, then execute
        — exactly one Huawei request per click, no batching, no automatic
        retries, no loops.
      </p>

      {!hasSelection ? (
        <p className="mt-4 text-sm text-white/60">
          No Huawei plant/devices found for this organization yet.
        </p>
      ) : (
        <div className="mt-6 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm text-white/60">
            Test
            <select
              className={selectClassName}
              value={testId}
              onChange={(event) => setTestId(event.target.value)}
            >
              {definitions.map((definition) => (
                <option key={definition.id} value={definition.id}>
                  {definition.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-white/60">
            Target
            <select
              className={selectClassName}
              value={targetKey}
              onChange={(event) => setTargetKey(event.target.value)}
            >
              {targets.map((target) => (
                <option key={target.key} value={target.key}>
                  {target.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            disabled={isPending}
            onClick={execute}
            className={buttonClassName}
          >
            {isPending ? "Running..." : "Execute"}
          </button>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

      {results.length > 0 && (
        <div className="mt-8 space-y-4">
          <h3 className="text-sm font-medium text-white/80">Results</h3>

          {results.map((result) => (
            <div
              key={`${result.testId}::${result.targetKey}::${result.ranAt}`}
              className="rounded-xl border border-white/10 bg-black/30 p-4 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-white/90">
                  {result.testLabel} — {result.targetLabel}
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
                  {result.success === true
                    ? "SUCCESS"
                    : result.success === false
                      ? "FAIL"
                      : "ERROR"}
                </span>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-white/60 sm:grid-cols-4">
                <div>
                  <dt className="text-white/40">Device type</dt>
                  <dd>{result.deviceType}</dd>
                </div>
                <div>
                  <dt className="text-white/40">HTTP status</dt>
                  <dd>{result.httpStatus ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-white/40">failCode</dt>
                  <dd>{result.failCode ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-white/40">Duration</dt>
                  <dd>{result.durationMs}ms</dd>
                </div>
                <div className="col-span-2 sm:col-span-4">
                  <dt className="text-white/40">Message</dt>
                  <dd>{result.message ?? "—"}</dd>
                </div>
                <div className="col-span-2 sm:col-span-4">
                  <dt className="text-white/40">Timestamp</dt>
                  <dd>{result.timestamp}</dd>
                </div>
              </dl>

              <div className="mt-3">
                <p className="text-white/40">Request</p>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-black/40 p-3 text-white/70">
                  {`POST ${result.endpoint}\n${JSON.stringify(result.requestBody, null, 2)}`}
                </pre>
              </div>

              <div className="mt-3">
                <p className="text-white/40">Response (raw)</p>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-black/40 p-3 text-white/70">
                  {JSON.stringify(result.responseBody, null, 2)}
                </pre>
              </div>

              {result.parsedResult !== null &&
                result.parsedResult !== undefined && (
                  <div className="mt-3">
                    <p className="text-white/40">Parsed</p>
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-black/40 p-3 text-white/70">
                      {JSON.stringify(result.parsedResult, null, 2)}
                    </pre>
                  </div>
                )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
