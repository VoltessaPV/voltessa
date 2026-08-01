import { getTranslations } from "next-intl/server";

import { MarketSummaryCard } from "@/components/market/MarketSummaryCard";
import type { TraderPortfolioSummary as TraderPortfolioSummaryData } from "@/lib/trader/queries";

type Props = {
  summary: TraderPortfolioSummaryData;
};

/**
 * Trader Workflow Simplification milestone. Moved here from
 * `components/dashboard/TraderPortfolioDashboard.tsx` (renamed
 * `TraderPortfolioDashboard` -> `TraderPortfolioSummary`, since it no longer
 * renders a whole page - Dashboard is now the selected client's dashboard,
 * exactly like Plant Owner's, so the portfolio-wide view lives only here,
 * at the top of the Clients page). The former "Quick access" client grid
 * is gone - it was a preview of at most a few clients; the Clients page it
 * now lives on already renders the full client grid/list immediately
 * below, so a second, smaller client listing would just be a duplicate.
 *
 * Deliberately shows only metrics backed by real data in this codebase
 * today (assigned clients, total plants, portfolio production, portfolio
 * revenue) - no fabricated "active alerts"/"total BESS" figures, since no
 * Alert or battery/BESS model exists anywhere yet.
 */
export async function TraderPortfolioSummary({ summary }: Props) {
  const hasClients = summary.assignedClientCount > 0;
  const t = await getTranslations("dashboard.trader");

  return (
    <section className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
      <MarketSummaryCard eyebrow={t("assignedClients")} value={summary.assignedClientCount.toString()} />

      <MarketSummaryCard eyebrow={t("totalPlants")} value={summary.totalPlantCount.toString()} />

      <MarketSummaryCard
        eyebrow={t("portfolioProduction")}
        value={hasClients ? summary.portfolioProductionKwh.toFixed(1) : undefined}
        valueUnit={hasClients ? "kWh" : undefined}
        unavailableNote={t("noClientsAssigned")}
      />

      <MarketSummaryCard
        eyebrow={t("portfolioRevenue")}
        value={hasClients ? summary.portfolioRevenueEur.toFixed(2) : undefined}
        valueUnit={hasClients ? "EUR" : undefined}
        unavailableNote={t("noClientsAssigned")}
      />
    </section>
  );
}
