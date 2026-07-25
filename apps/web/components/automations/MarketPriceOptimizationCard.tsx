"use client";

import { useEffect, useState, useTransition } from "react";

import { updateMarketPriceAutomation } from "@/app/(platform)/automations/actions";
import CardHeader from "@/components/dashboard/CardHeader";
import Card from "@/components/ui/Card";

type Props = {
  initialEnabled: boolean;
  initialMinimumExportPrice: string;
};

type ToastState = { kind: "success" | "error"; message: string } | null;

/**
 * The only UI that edits AutomationSettings.automationEnabled /
 * minimumExportPrice (previously duplicated on /settings, removed there -
 * see updateMarketPriceAutomation). Deliberately plain-language: no
 * mention of Active Power Control, Zero Export, Huawei, dongles, or
 * FusionSolar - the user is configuring a business rule, not a vendor
 * command.
 */
export function MarketPriceOptimizationCard({
  initialEnabled,
  initialMinimumExportPrice,
}: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [threshold, setThreshold] = useState(initialMinimumExportPrice);
  const [isPending, startTransition] = useTransition();
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  function handleSave() {
    if (isPending) {
      return;
    }

    setToast(null);

    startTransition(async () => {
      const result = await updateMarketPriceAutomation({
        enabled,
        minimumExportPrice: threshold,
      });

      setToast(
        result.ok
          ? { kind: "success", message: "Automation settings saved" }
          : { kind: "error", message: result.error },
      );
    });
  }

  return (
    <>
      <Card className="p-6">
        <CardHeader
          title="Market Price Optimization"
          subtitle="Automatically stops exporting electricity to the grid when the market price falls below your threshold, and resumes automatically once the price recovers."
        />

        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <span className="text-sm text-white/80">Enable automation</span>

          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => setEnabled((prev) => !prev)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
              enabled ? "bg-emerald-400/80" : "bg-slate-600"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        <div className="mt-4">
          <label
            htmlFor="minimumExportPrice"
            className="block text-sm text-white/80"
          >
            When electricity price falls below (€/MWh)
          </label>

          <input
            id="minimumExportPrice"
            type="number"
            step="0.01"
            min="0"
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
            className="mt-2 w-40 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-white"
          />
        </div>

        <button
          type="button"
          disabled={isPending}
          onClick={handleSave}
          className="mt-6 rounded-xl bg-blue-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Save"}
        </button>
      </Card>

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
