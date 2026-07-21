"use client";

import { useEffect, useState, useTransition } from "react";

import { refreshFusionSolarTelemetry } from "@/app/(platform)/dashboard/actions";

/**
 * Database-First Telemetry Architecture milestone. The one explicit,
 * human-initiated "synchronize now" control — normal page loads and
 * refreshes never contact Huawei; this button is the deliberate exception.
 * Shared by Dashboard and Market. Follows `HuaweiControlCard.tsx`'s
 * existing pattern (`useTransition`, pending/disabled state, toast) rather
 * than introducing a second client-component convention.
 */

type ToastState = { kind: "success" | "error"; message: string } | null;

export function RefreshButton() {
  const [isPending, startTransition] = useTransition();
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  function handleClick() {
    if (isPending) {
      return;
    }

    setToast(null);

    startTransition(async () => {
      const result = await refreshFusionSolarTelemetry();

      setToast(
        result.ok
          ? { kind: "success", message: "Telemetry refreshed" }
          : { kind: "error", message: result.error },
      );
    });
  }

  return (
    <>
      <button
        type="button"
        disabled={isPending}
        onClick={handleClick}
        className="h-8 rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs font-medium text-slate-300 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Refreshing..." : "Refresh"}
      </button>

      {toast && (
        <div
          className={`fixed bottom-6 right-6 rounded-xl border px-4 py-3 text-sm shadow-[0_12px_28px_-16px_rgba(0,0,0,0.55)] ${
            toast.kind === "success"
              ? "border-green-500/20 bg-green-500/10 text-green-300"
              : "border-red-500/20 bg-red-500/10 text-red-300"
          }`}
        >
          {toast.kind === "success" ? "✓" : "✕"} {toast.message}
        </div>
      )}
    </>
  );
}
