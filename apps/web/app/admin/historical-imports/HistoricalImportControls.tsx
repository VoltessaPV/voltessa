"use client";

import { useEffect, useState, useTransition } from "react";

import { continueHistoricalImportJob, createHistoricalImportJob } from "./actions";

type ToastState = { kind: "success" | "error"; message: string } | null;

const inputClassName =
  "rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none";

const buttonClassName =
  "rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-blue-600";

/**
 * Database-First Architecture milestone. Platform Admin's only UI (besides
 * the one-time onboarding import) that can trigger a historical Huawei/
 * ENTSO-E import - Dashboard/Market never do. Same `useTransition`/
 * pending-state/toast pattern already established for this app's other
 * "real backend action, needs visible feedback" client components (see
 * `HuaweiControlCard.tsx`).
 */
export function NewHistoricalImportForm({
  organizations,
}: {
  organizations: Array<{ id: string; name: string }>;
}) {
  const [isPending, startTransition] = useTransition();
  const [importType, setImportType] = useState<"month" | "year" | "custom" | "complete">("month");
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      try {
        await createHistoricalImportJob(formData);
        setToast({ kind: "success", message: "Import started." });
      } catch (error) {
        setToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to start import." });
      }
    });
  }

  return (
    <form action={handleSubmit} className="flex flex-wrap items-end gap-3 text-sm">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-white/50">Organization</label>
        <select name="organizationId" required className={inputClassName}>
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-white/50">Import type</label>
        <select
          name="importType"
          value={importType}
          onChange={(event) => setImportType(event.target.value as typeof importType)}
          className={inputClassName}
        >
          <option value="month">One calendar month (current)</option>
          <option value="year">One calendar year (current)</option>
          <option value="custom">Custom date range</option>
          <option value="complete">Complete history</option>
        </select>
      </div>

      {importType === "custom" && (
        <>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-white/50">Start date</label>
            <input type="date" name="rangeStart" required className={inputClassName} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-white/50">End date</label>
            <input type="date" name="rangeEnd" required className={inputClassName} />
          </div>
        </>
      )}

      <button type="submit" disabled={isPending} className={buttonClassName}>
        {isPending ? "Starting…" : "Start Import"}
      </button>

      {toast && (
        <span className={toast.kind === "success" ? "text-xs text-emerald-400" : "text-xs text-red-400"}>
          {toast.kind === "success" ? "✓" : "✕"} {toast.message}
        </span>
      )}
    </form>
  );
}

export function ContinueImportButton({ jobId }: { jobId: string }) {
  const [isPending, startTransition] = useTransition();
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  function handleClick() {
    startTransition(async () => {
      try {
        await continueHistoricalImportJob(jobId);
      } catch (error) {
        setToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to continue import." });
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Importing…" : "Continue"}
      </button>
      {toast && <span className="text-xs text-red-400">{toast.message}</span>}
    </div>
  );
}
