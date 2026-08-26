import { NextRequest, NextResponse } from "next/server";

import { getDashboardPageData } from "@/app/[locale]/(platform)/dashboard/dashboard-data";
import { requireApiPermission } from "@/lib/auth/api-session";
import { Permissions } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ plantId: string }> };

/**
 * Mobile Client Architecture milestone (ADR-020). Reuses
 * `getDashboardPageData` verbatim — the exact same function
 * `dashboard/page.tsx` calls for Web, called here with the identical
 * argument shape (`organizationId`, `automationSettings`, optional
 * `date`/`period` query params). No business logic is duplicated; this
 * route is purely: authenticate -> verify plant ownership -> fetch the
 * same small `automationSettings` projection `dashboard/page.tsx` already
 * fetches -> call the same function -> return its result as JSON.
 *
 * `getDashboardPageData` internally calls
 * `lib/telemetry/plant-context.ts`'s `resolvePlantContext(organizationId)`,
 * which has since been made provider-neutral (see that file's own doc
 * comment) — it no longer filters on `vendor: "Huawei"` and resolves the
 * organization's connection via the canonical `getOrganizationProviderConnection`
 * regardless of provider. This endpoint is therefore correct for a Huawei-
 * or Sungrow-connected organization alike, not just Huawei's.
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

  const data = await getDashboardPageData(auth.user.organizationId, automationSettings, dateParam, period);

  return NextResponse.json(data);
}
