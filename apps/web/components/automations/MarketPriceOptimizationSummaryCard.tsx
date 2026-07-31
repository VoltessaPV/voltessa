import { getTranslations } from "next-intl/server";

import CardHeader from "@/components/dashboard/CardHeader";
import Card from "@/components/ui/Card";

type Props = {
  enabled: boolean;
  minimumExportPrice: string;
};

/**
 * Trader Self-Service Onboarding milestone. The read-only counterpart to
 * `MarketPriceOptimizationCard` - same title/subtitle, same information,
 * but a plain Server Component with no toggle, no input, no Save button,
 * and no `"use client"`/`updateMarketPriceAutomation` import at all.
 * Rendered for an Energy Trader viewing an assigned organization's
 * Automations page - Traders must never see, let alone reach, the write
 * path this setting has.
 */
export async function MarketPriceOptimizationSummaryCard({ enabled, minimumExportPrice }: Props) {
  const [t, tTerm] = await Promise.all([
    getTranslations("automations.marketPriceCard"),
    getTranslations("terminology"),
  ]);

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
      </dl>
    </Card>
  );
}
