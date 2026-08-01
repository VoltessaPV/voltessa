import { getTranslations } from "next-intl/server";

import { requireTraderOrganizationAccess } from "@/lib/auth/session";
import { getTraderPortfolioSummary, listTraderClients } from "@/lib/trader/queries";

import { ClientCardGrid } from "@/components/clients/ClientCardGrid";
import { ClientTable } from "@/components/clients/ClientTable";
import { TraderPortfolioSummary } from "@/components/clients/TraderPortfolioSummary";
import { EmptyState } from "@/components/platform/EmptyState";
import { PageContainer } from "@/components/platform/layout/PageContainer";


/** Above this many clients, default to the table view - a grid of cards stops being scannable well before "dozens to hundreds." Either view is always explicitly selectable via `?view=`. */
const GRID_VIEW_MAX_CLIENTS = 12;

type Props = {
  searchParams: Promise<{ q?: string; view?: string; returnTo?: string }>;
};

/**
 * Trader Workflow Simplification milestone. Clients is now the Trader's
 * home and portfolio overview in one - built for browsing and getting into
 * a client quickly, not for managing records (editing/removing an
 * assignment stays Platform Admin's job under `/admin/assignments`).
 * Selecting a client here is a context switch, not a page navigation - it
 * redirects back to `redirectTo` (whatever page the trader arrived from via
 * the header's "Switch client" link, or this page itself by default), never
 * unconditionally to Dashboard.
 *
 * The portfolio KPI summary (formerly its own Trader Dashboard landing
 * page - see `TraderPortfolioSummary`'s own doc comment) now leads this
 * page, answering "what is happening across my portfolio?" before the
 * existing client grid/list answers "which client do I want to look at?" -
 * one page, not two duplicate entry points into the same client list.
 */
export default async function ClientsPage({ searchParams }: Props) {
  const access = await requireTraderOrganizationAccess();
  const params = await searchParams;

  const [clients, summary] = await Promise.all([
    listTraderClients(access.trader.id, params.q),
    getTraderPortfolioSummary(access.trader.id),
  ]);
  const redirectTo = params.returnTo ?? "/clients";

  const view: "grid" | "list" =
    params.view === "grid" || params.view === "list"
      ? params.view
      : clients.length > GRID_VIEW_MAX_CLIENTS
        ? "list"
        : "grid";

  const viewHref = (nextView: "grid" | "list") => {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    query.set("view", nextView);
    return `/clients?${query.toString()}`;
  };

  const t = await getTranslations("clients.page");

  return (
    <PageContainer className="space-y-3">
      <TraderPortfolioSummary summary={summary} />

      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        <form method="get" className="flex items-center gap-2">
          <input
            type="text"
            name="q"
            defaultValue={params.q ?? ""}
            placeholder={t("searchPlaceholder")}
            className="h-9 w-64 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-blue-500"
          />
          {view !== (clients.length > GRID_VIEW_MAX_CLIENTS ? "list" : "grid") && (
            <input type="hidden" name="view" value={view} />
          )}
          <button
            type="submit"
            className="h-9 rounded-lg border border-white/10 px-3 text-sm text-white/70 transition hover:border-white/20 hover:text-white"
          >
            {t("searchButton")}
          </button>
        </form>

        <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-0.5">
          <a
            href={viewHref("grid")}
            className={
              view === "grid"
                ? "rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium text-white"
                : "rounded-md px-3 py-1.5 text-xs font-medium text-white/50 hover:text-white"
            }
          >
            {t("gridViewButton")}
          </a>
          <a
            href={viewHref("list")}
            className={
              view === "list"
                ? "rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium text-white"
                : "rounded-md px-3 py-1.5 text-xs font-medium text-white/50 hover:text-white"
            }
          >
            {t("listViewButton")}
          </a>
        </div>
      </div>

      {clients.length === 0 ? (
        <EmptyState
          title={params.q ? t("noSearchResultsTitle") : t("noClientsTitle")}
          description={params.q ? t("noSearchResultsDescription") : t("noClientsDescription")}
        />
      ) : view === "grid" ? (
        <ClientCardGrid clients={clients} redirectTo={redirectTo} />
      ) : (
        <ClientTable clients={clients} redirectTo={redirectTo} />
      )}
    </PageContainer>
  );
}
