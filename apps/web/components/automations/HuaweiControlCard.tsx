"use client";

import { useEffect, useState, useTransition } from "react";

import {
  sendHuaweiNoLimit,
  sendHuaweiZeroExport,
} from "@/app/(platform)/automations/actions";

type ToastState = { kind: "success" | "error"; message: string } | null;

const buttonClassName =
  "rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-blue-600";

export function HuaweiControlCard() {
  const [isPending, startTransition] = useTransition();
  // Which button triggered the in-flight request - both stay disabled
  // while either is pending (never send duplicate requests), but this
  // still lets each button show its own label while working.
  const [pendingAction, setPendingAction] = useState<
    "no-limit" | "zero-export" | null
  >(null);
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  function runCommand(
    action: "no-limit" | "zero-export",
    send: () => Promise<{ ok: boolean; error?: string }>,
  ) {
    if (isPending) {
      return;
    }

    setPendingAction(action);
    setToast(null);

    startTransition(async () => {
      const result = await send();

      setPendingAction(null);
      setToast(
        result.ok
          ? { kind: "success", message: "Huawei command sent successfully" }
          : { kind: "error", message: "Failed to send Huawei command" },
      );
    });
  }

  return (
    <>
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h2 className="text-lg font-medium">Huawei Control (Testing)</h2>

        <p className="mt-2 text-sm text-white/60">
          Manual commands used to validate Huawei FusionSolar integration.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={isPending}
            onClick={() => runCommand("no-limit", sendHuaweiNoLimit)}
            className={buttonClassName}
          >
            {pendingAction === "no-limit" ? "Sending..." : "Enable No Limit"}
          </button>

          <button
            type="button"
            disabled={isPending}
            onClick={() => runCommand("zero-export", sendHuaweiZeroExport)}
            className={buttonClassName}
          >
            {pendingAction === "zero-export"
              ? "Sending..."
              : "Enable Zero Export"}
          </button>
        </div>
      </section>

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
