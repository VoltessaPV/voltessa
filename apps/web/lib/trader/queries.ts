import { getMarketPageData } from "@/app/(platform)/market/market-data";
import { getProductionPageData } from "@/app/(platform)/market/production-data";
import { ensureTelemetryFresh } from "@/lib/fusionsolar/telemetry-sync-service";
import { computeExportRevenue } from "@/lib/market-price/revenue";
import { prisma } from "@/lib/prisma";
import { resolvePlantContext } from "@/lib/telemetry/plant-context";

export type TraderClient = {
  organizationId: string;
  name: string;
  plantCount: number;
  connected: boolean;
};

/**
 * Trader Workspace milestone. The trader's client portfolio - every
 * organization this trader is assigned to, via their own `TraderAssignment`
 * rows only (never a cross-tenant reach - contrast with
 * `lib/admin/queries.ts`, which is deliberately cross-organization because
 * Platform Admin's reach is different in kind). Framed for browsing
 * ("which clients do I have, which ones have I connected"), not for
 * management - editing/removing an assignment stays Platform Admin's job
 * under `/admin/assignments`.
 *
 * `search` filters by organization name (case-insensitive `contains`) -
 * plain, no pagination: comfortably handles the "dozens to low hundreds"
 * scale this was designed for. Worth revisiting only if a trader's real
 * portfolio outgrows a single filtered screen.
 */
export async function listTraderClients(
  traderId: string,
  search?: string,
): Promise<TraderClient[]> {
  const assignments = await prisma.traderAssignment.findMany({
    where: {
      traderId,
      ...(search
        ? { organization: { name: { contains: search, mode: "insensitive" } } }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      organization: {
        select: {
          id: true,
          name: true,
          _count: { select: { plants: true } },
          fusionSolarConnections: { select: { id: true }, take: 1 },
        },
      },
    },
  });

  return assignments.map(({ organization }) => ({
    organizationId: organization.id,
    name: organization.name,
    plantCount: organization._count.plants,
    connected: organization.fusionSolarConnections.length > 0,
  }));
}

export type TraderPortfolioSummary = {
  assignedClientCount: number;
  totalPlantCount: number;
  /** Sum of today's exported energy across every assigned client's connected plant - null entries (no telemetry yet) are simply excluded, not treated as zero. */
  portfolioProductionKwh: number;
  portfolioRevenueEur: number;
};

/**
 * Trader Workspace milestone. The Trader Portfolio Dashboard's aggregate
 * metrics - always computed across every assigned client, regardless of
 * which one (if any) is currently "selected" via the context cookie. Only
 * four metrics are backed by real data in this codebase today (assigned
 * clients, total plants, portfolio production, portfolio revenue); "total
 * BESS" and "active alerts" are deliberately not included here - no
 * battery/BESS model and no Alert model exist anywhere in this codebase
 * yet (see bess/page.tsx's own doc comment), so showing either would mean
 * fabricating a number rather than reporting one.
 *
 * Uses background telemetry-freshness mode (never blocking) - a trader's
 * portfolio can span many organizations, and forcing a synchronous
 * Huawei-gateway round trip for every one of them on every Dashboard
 * render would not scale the way a single-organization Dashboard's
 * blocking sync does.
 */
export async function getTraderPortfolioSummary(
  traderId: string,
): Promise<TraderPortfolioSummary> {
  const assignments = await prisma.traderAssignment.findMany({
    where: { traderId },
    select: { organizationId: true },
  });

  const organizationIds = assignments.map((assignment) => assignment.organizationId);

  if (organizationIds.length === 0) {
    return {
      assignedClientCount: 0,
      totalPlantCount: 0,
      portfolioProductionKwh: 0,
      portfolioRevenueEur: 0,
    };
  }

  const [totalPlantCount, priceData] = await Promise.all([
    prisma.plant.count({ where: { organizationId: { in: organizationIds } } }),
    getMarketPageData({ organizationId: null, selectedDateParam: undefined, automationSettings: null }),
  ]);

  let portfolioProductionKwh = 0;
  let portfolioRevenueEur = 0;

  await Promise.all(
    organizationIds.map(async (organizationId) => {
      await ensureTelemetryFresh(organizationId, { mode: "background" });

      const context = await resolvePlantContext(organizationId);
      if (!context) {
        return;
      }

      const production = await getProductionPageData(organizationId, undefined);

      portfolioProductionKwh += production.settlementEnergySeries.reduce(
        (sum, point) => sum + (point.exportedKwh ?? 0),
        0,
      );

      if (priceData.dataAvailable) {
        const revenue = computeExportRevenue(priceData.series, production.settlementEnergySeries);
        if (revenue.available) {
          portfolioRevenueEur += revenue.revenueEur;
        }
      }
    }),
  );

  return {
    assignedClientCount: organizationIds.length,
    totalPlantCount,
    portfolioProductionKwh: Math.round(portfolioProductionKwh * 100) / 100,
    portfolioRevenueEur: Math.round(portfolioRevenueEur * 100) / 100,
  };
}
