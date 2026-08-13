"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";

import { updateMarketPriceAutomation } from "@/app/[locale]/(platform)/automations/actions";
import CardHeader from "@/components/dashboard/CardHeader";
import Card from "@/components/ui/Card";

/**
 * Matches Prisma's generated `DayOfWeek` enum structurally (same string
 * values) without importing `@prisma/client` into client-side code - same
 * reasoning as `lib/automation/export-decision.ts`'s hand-written
 * `ExportMode` union for the Automation Service's vocabulary: a plain
 * client component must never bundle the Prisma client runtime.
 */
type DayOfWeek =
  | "MONDAY"
  | "TUESDAY"
  | "WEDNESDAY"
  | "THURSDAY"
  | "FRIDAY"
  | "SATURDAY"
  | "SUNDAY";

const DAYS_OF_WEEK: DayOfWeek[] = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];

type Props = {
  initialEnabled: boolean;
  initialMinimumExportPrice: string;
  initialEnabledDays: DayOfWeek[];
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
  initialEnabledDays,
}: Props) {
  const t = useTranslations("automations.marketPriceCard");
  const tActions = useTranslations("shared.actions");
  const [enabled, setEnabled] = useState(initialEnabled);
  const [threshold, setThreshold] = useState(initialMinimumExportPrice);
  const [enabledDays, setEnabledDays] = useState<DayOfWeek[]>(initialEnabledDays);
  const [isPending, startTransition] = useTransition();
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  function toggleDay(day: DayOfWeek) {
    setEnabledDays((prev) =>
      prev.includes(day) ? prev.filter((selected) => selected !== day) : [...prev, day],
    );
  }

  function handleSave() {
    if (isPending) {
      return;
    }

    setToast(null);

    startTransition(async () => {
      const result = await updateMarketPriceAutomation({
        enabled,
        minimumExportPrice: threshold,
        enabledDays,
      });

      setToast(
        result.ok
          ? { kind: "success", message: t("savedToast") }
          : { kind: "error", message: t(result.code) },
      );
    });
  }

  return (
    <>
      <Card className="p-6">
        <CardHeader title={t("title")} subtitle={t("subtitle")} />

        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <span className="text-sm text-white/80">{t("enableAutomation")}</span>

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

        {enabled && (
          <div className="mt-4">
            <span className="block text-sm text-white/80">{t("daysOfWeekLabel")}</span>

            <div className="mt-2 flex flex-wrap gap-2">
              {DAYS_OF_WEEK.map((day) => {
                const isSelected = enabledDays.includes(day);

                return (
                  <button
                    key={day}
                    type="button"
                    role="checkbox"
                    aria-checked={isSelected}
                    onClick={() => toggleDay(day)}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                      isSelected
                        ? "border-emerald-400/40 bg-emerald-400/80 text-white"
                        : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
                    }`}
                  >
                    {t(`days.${day.toLowerCase()}` as never)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-4">
          <label
            htmlFor="minimumExportPrice"
            className="block text-sm text-white/80"
          >
            {t("thresholdLabel")}
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
          {isPending ? tActions("saving") : tActions("save")}
        </button>
      </Card>

      {toast && (
        <div
          className={`fixed inset-x-4 bottom-6 rounded-xl border px-4 py-3 text-sm shadow-[0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:inset-x-auto sm:right-6 sm:max-w-sm ${
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
