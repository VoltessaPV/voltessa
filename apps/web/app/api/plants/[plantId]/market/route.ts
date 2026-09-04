import { NextRequest, NextResponse } from "next/server";

import { getMarketPageData } from "@/app/[locale]/(platform)/market/market-data";
import { getProductionPageData } from "@/app/[locale]/(platform)/market/production-data";
import { requireApiPermission } from "@/lib/auth/api-session";
import { getStoredExportMode } from "@/lib/automation/automation-state";
import { Permissions } from "@/lib/auth/permissions";
import { computeExportRevenue, type RevenueSummary } from "@/lib/market-price/revenue";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ plantId: string }> };

/**
 * Mobile Client Architecture milestone (ADR-020), M4. Reuses
 * `getMarketPageData` verbatim - the exact same function the Web Market
 * page calls, called here with the identical argument shape
 * (`organizationId`, `automationSettings`, optional `date`/`period` query
 * params) - mirrors `dashboard/route.ts`'s own established pattern
 * exactly. No business logic is duplicated; this route is purely:
 * authenticate -> verify plant ownership -> fetch the same small
 * `automationSettings` projection the Market page already fetches -> call
 * the same function -> return its result as JSON.
 *
 * `plantId` is only used for ownership verification (this endpoint is
 * still reached via /api/plants/:plantId/market for URL symmetry with the
 * other plant-scoped mobile endpoints) - `getMarketPageData` itself is
 * organization-scoped, not plant-scoped, matching how the Market page
 * itself works (one market view per organization, not per plant).
 *
 * Mobile/Web Parity milestone: adds `currentExportMode` on top of
 * `getMarketPageData`'s own result - the one field Web's Market page reads
 * from a second source (`getStoredExportMode`, the same function
 * `dashboard-data.ts`/the automation scheduler already call) to render its
 * "Configured Mode" status. Reused verbatim, not reimplemented; every other
 * field in the response is still exactly `getMarketPageData`'s own,
 * unchanged, including `series`/`previousPeriodSeries` (already present in
 * this JSON response before this change - the Mobile client simply didn't
 * model them yet).
 *
 * Mobile Redesign milestone: also adds `revenue` - the exact same
 * meter-then-production-fallback composition `page.tsx` already does
 * (`computeExportRevenue`, fed `getProductionPageData`'s
 * settlementEnergySeries/productionEnergySeries), reused verbatim rather
 * than reimplemented. Only computed for `dataAvailable: true` + "today"
 * (Mobile's Market screen doesn't have a period switcher yet - see
 * `MarketPageResponse`'s own doc comment).
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireApiPermission(request, Permissions.canViewPlants);

  if (!auth.ok) {
    return auth.response;
  }

  const { plantId } = await params;

  const plant = await prisma.plant.findFirst({
    where: { id: plantId, organizationId: auth.user.organizationId },
    select: { id: true },
  });

  if (!plant) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const automationSettings = await prisma.automationSettings.findUnique({
    where: { organizationId: auth.user.organizationId },
    select: { minimumExportPrice: true, currency: true },
  });

  const dateParam = request.nextUrl.searchParams.get("date") ?? undefined;
  const periodParam = request.nextUrl.searchParams.get("period");
  const period = periodParam === "week" || periodParam === "month" || periodParam === "year" ? periodParam : "today";

  const [data, currentExportMode, production] = await Promise.all([
    getMarketPageData({
      organizationId: auth.user.organizationId,
      selectedDateParam: dateParam,
      period,
      automationSettings,
    }),
    getStoredExportMode(auth.user.organizationId),
    getProductionPageData(auth.user.organizationId, dateParam, period),
  ]);

  // Same meter-then-production fallback page.tsx already does: a plant
  // with a real meter always resolves via settlementEnergySeries; one
  // without falls back to productionEnergySeries, priced the same way -
  // never a second revenue calculation.
  let revenue: RevenueSummary = { available: false };

  if (data.dataAvailable) {
    const meterRevenue = computeExportRevenue(data.series, production.settlementEnergySeries);

    revenue = meterRevenue.available
      ? meterRevenue
      : computeExportRevenue(
          data.series,
          production.productionEnergySeries.map((point) => ({
            intervalStart: point.intervalStart,
            exportedKwh: point.producedKwh,
            importedKwh: null,
          })),
        );
  }

  return NextResponse.json({ ...data, currentExportMode, revenue });
}
