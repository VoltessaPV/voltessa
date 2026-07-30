import Link from "next/link";

import { ClientCardGrid } from "@/components/clients/ClientCardGrid";
import { MarketSummaryCard } from "@/components/market/MarketSummaryCard";
import { PageContainer } from "@/components/platform/layout/PageContainer";
import type { TraderClient, TraderPortfolioSummary } from "@/lib/trader/queries";

/** Quick access shows at most this many clients - a fast way into recent work, not a second copy of the full Clients directory. */
const QUICK_ACCESS_MAX_CLIENTS = 6;

type Props = {
  summary: TraderPortfolioSummary;
  quickAccessClients: TraderClient[];
};

/**
 * Trader Workspace milestone. The trader's landing page - always the
 * whole-portfolio view, regardless of which (if any) client is currently
 * selected via the context cookie. Deliberately shows only metrics backed
 * by real data in this codebase today (assigned clients, total plants,
 * portfolio production, portfolio revenue) - no fabricated "active
 * alerts"/"total BESS" figures, since no Alert or battery/BESS model
 * exists anywhere yet.
 *
 * Quick access reuses the existing assignment list (ordered
 * most-recently-assigned first by `listTraderClients`) rather than a
 * dedicated "recently viewed"/"pinned" concept - that's a deliberate,
 * explicit scope cut for this milestone, not an oversight.
 */
export function TraderPortfolioDashboard({ summary, quickAccessClients }: Props) {
  const hasClients = summary.assignedClientCount > 0;

  return (
    <PageContainer className="space-y-3">
      <section className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <MarketSummaryCard eyebrow="Assigned Clients" value={summary.assignedClientCount.toString()} />

        <MarketSummaryCard eyebrow="Total Plants" value={summary.totalPlantCount.toString()} />

        <MarketSummaryCard
          eyebrow="Portfolio Production"
          value={hasClients ? summary.portfolioProductionKwh.toFixed(1) : undefined}
          valueUnit={hasClients ? "kWh" : undefined}
          unavailableNote="No clients assigned yet"
        />

        <MarketSummaryCard
          eyebrow="Portfolio Revenue"
          value={hasClients ? summary.portfolioRevenueEur.toFixed(2) : undefined}
          valueUnit={hasClients ? "EUR" : undefined}
          unavailableNote="No clients assigned yet"
        />
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Quick access</h2>
            <p className="mt-0.5 text-xs text-slate-500">Jump straight into a client</p>
          </div>

          {hasClients && (
            <Link href="/clients" className="text-xs font-medium text-blue-400 hover:text-blue-300">
              View all clients
            </Link>
          )}
        </div>

        <div className="mt-3">
          {hasClients ? (
            <ClientCardGrid
              clients={quickAccessClients.slice(0, QUICK_ACCESS_MAX_CLIENTS)}
              redirectTo="/dashboard"
            />
          ) : (
            <p className="text-sm text-white/60">
              You&apos;re all set. Clients you&apos;re assigned to will show up here for quick
              access - a Platform Administrator will assign you shortly.
            </p>
          )}
        </div>
      </section>
    </PageContainer>
  );
}
