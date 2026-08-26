import { NextRequest, NextResponse } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-session";
import { Permissions } from "@/lib/auth/permissions";
import { getOrganizationProviderConnection } from "@/lib/provider-connection";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ plantId: string }> };

/**
 * Mobile Client Architecture milestone (ADR-020). Reuses
 * `getOrganizationProviderConnection` (`lib/provider-connection.ts`) —
 * already built, provider-neutral, previously unused by any caller — no new
 * connection-resolution logic. Response intentionally surfaces `provider`
 * (Huawei or Sungrow) as the one deliberately normalized identity concept
 * this endpoint exists to expose (per the approved API design), never a
 * vendor-specific field name, credential, or token.
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

  const connection = await getOrganizationProviderConnection(auth.user.organizationId);

  return NextResponse.json({
    connected: connection !== null,
    provider: connection?.provider ?? null,
  });
}
