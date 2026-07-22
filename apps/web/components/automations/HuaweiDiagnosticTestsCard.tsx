"use client";

import { useState, useTransition } from "react";

import { runHuaweiDiagnosticTest } from "@/app/(platform)/automations/actions";
import type {
  DiagnosticIdentifier,
  DiagnosticTestResult,
} from "@/lib/fusionsolar/diagnostic-tests";

type Props = {
  identifiers: DiagnosticIdentifier[];
  definitions: Array<{ id: string; label: string }>;
};

type ResultEntry = DiagnosticTestResult & { ranAt: number };

const buttonClassName =
  "rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50";

function resultKey(testId: string, identifier: string): string {
  return `${testId}::${identifier}`;
}

export function HuaweiDiagnosticTestsCard({ identifiers, definitions }: Props) {
  const [isPending, startTransition] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [results, setResults] = useState<ResultEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  function runTest(testId: string, target: DiagnosticIdentifier) {
    if (isPending) {
      return;
    }

    setPendingKey(resultKey(testId, target.identifier));
    setError(null);

    startTransition(async () => {
      const outcome = await runHuaweiDiagnosticTest(testId, target.identifier);

      setPendingKey(null);

      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }

      setResults((prev) => [{ ...outcome.result, ranAt: Date.now() }, ...prev]);
    });
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <h2 className="text-lg font-medium">Huawei Diagnostic Tests</h2>

      <p className="mt-2 text-sm text-white/60">
        Engineering diagnostics only. Each button sends exactly one read-only
        Huawei API request and prints the complete request/response below —
        no batching, no automatic retries, no loops.
      </p>

      {identifiers.length === 0 ? (
        <p className="mt-4 text-sm text-white/60">
          No Huawei plant/devices found for this organization yet.
        </p>
      ) : (
        definitions.map((definition) => (
          <div key={definition.id} className="mt-6">
            <h3 className="text-sm font-medium text-white/80">
              {definition.label}
            </h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {identifiers.map((target) => {
                const key = resultKey(definition.id, target.identifier);
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={isPending}
                    onClick={() => runTest(definition.id, target)}
                    className={buttonClassName}
                  >
                    {pendingKey === key ? "Running..." : target.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}

      {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

      {results.length > 0 && (
        <div className="mt-8 space-y-4">
          <h3 className="text-sm font-medium text-white/80">Results</h3>

          {results.map((result) => (
            <div
              key={`${result.testId}::${result.identifier}::${result.ranAt}`}
              className="rounded-xl border border-white/10 bg-black/30 p-4 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-white/90">
                  {result.testLabel} — {result.identifierLabel}
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
                  {`POST ${result.requestPath}\n${JSON.stringify(result.requestBody, null, 2)}`}
                </pre>
              </div>

              <div className="mt-3">
                <p className="text-white/40">Response (raw)</p>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-black/40 p-3 text-white/70">
                  {JSON.stringify(result.responseBody, null, 2)}
                </pre>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
