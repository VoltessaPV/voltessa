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
export function MarketPriceOptimizationSummaryCard({ enabled, minimumExportPrice }: Props) {
  return (
    <Card className="p-6">
      <CardHeader
        title="Market Price Optimization"
        subtitle="Automatically stops exporting electricity to the grid when the market price falls below the configured threshold, and resumes automatically once the price recovers."
      />

      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <dt className="text-xs text-white/50">Automation</dt>
          <dd className="mt-1 text-sm text-white/80">{enabled ? "Enabled" : "Disabled"}</dd>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <dt className="text-xs text-white/50">Export stops below</dt>
          <dd className="mt-1 text-sm text-white/80">€{minimumExportPrice} / MWh</dd>
        </div>
      </dl>
    </Card>
  );
}
