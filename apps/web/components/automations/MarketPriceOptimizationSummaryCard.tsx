import { getTranslations } from "next-intl/server";

import CardHeader from "@/components/dashboard/CardHeader";
import Card from "@/components/ui/Card";

import { ALL_DAYS_OF_WEEK } from "@/lib/automation/day-of-week";
import type { DayOfWeek } from "@prisma/client";

type Props = {
  enabled: boolean;
  minimumExportPrice: string;
  enabledDays: DayOfWeek[];
};

/**
 * Trader Self-Service Onboarding milestone. The read-only counterpart to
 * `MarketPriceOptimizationCard` - same title/subtitle, same information,
 * but a plain Server Component with no toggle, no input, no Save button,
 * and no `"use client"`/`updateMarketPriceAutomation` import at all.
 * Rendered for an Energy Trader viewing an assigned organization's
 * Automations page - Traders must never see, let alone reach, the write
 * path this setting has.
 *
 * `enabledDays` display is a Server Component, so it can import the real
 * Prisma `DayOfWeek` type/`ALL_DAYS_OF_WEEK` directly - unlike the
 * client-side `MarketPriceOptimizationCard`, there is no bundling concern
 * here.
 */
export async function MarketPriceOptimizationSummaryCard({
  enabled,
  minimumExportPrice,
  enabledDays,
}: Props) {
  const [t, tTerm] = await Promise.all([
    getTranslations("automations.marketPriceCard"),
    getTranslations("terminology"),
  ]);

  const enabledDaySet = new Set(enabledDays);
  const daysLabel =
    enabledDays.length === 0
      ? t("daysNoneSelected")
      : ALL_DAYS_OF_WEEK.filter((day) => enabledDaySet.has(day))
          .map((day) => t(`days.${day.toLowerCase()}` as never))
          .join(", ");

  return (
    <Card className="p-6">
      <CardHeader title={t("title")} subtitle={t("subtitleReadOnly")} />

      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <dt className="text-xs text-white/50">{tTerm("automation")}</dt>
          <dd className="mt-1 text-sm text-white/80">{enabled ? t("enabled") : t("disabled")}</dd>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <dt className="text-xs text-white/50">{t("exportStopsBelowLabel")}</dt>
          <dd className="mt-1 text-sm text-white/80">€{minimumExportPrice} / MWh</dd>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 sm:col-span-2">
          <dt className="text-xs text-white/50">{t("daysOfWeekLabel")}</dt>
          <dd className="mt-1 text-sm text-white/80">{daysLabel}</dd>
        </div>
      </dl>
    </Card>
  );
}
