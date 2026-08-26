import { NextRequest, NextResponse } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-session";
import { Permissions } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * Mobile Client Architecture milestone (ADR-020). Provider-neutral by
 * construction: the select below deliberately omits `vendor`, `stationCode`,
 * and `plantCode` — the client only ever sees the plant concepts ADR-020
 * requires (id/name/capacity/location), never a vendor-specific identifier.
 *
 * No pre-existing shared "list plants for an organization" function existed
 * to reuse — this is a new, but genuinely trivial, scoped read, not a
 * duplication of business logic that lives anywhere else.
 *
 * Deliberately organization-scoped, not vendor-scoped — unlike
 * `resolvePlantContext` (see that file's own doc comment and ADR-018), this
 * query has no vendor filter at all, so it already lists a Sungrow-connected
 * plant exactly as readily as a Huawei-connected one.
 */
export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, Permissions.canViewPlants);

  if (!auth.ok) {
    return auth.response;
  }

  const plants = await prisma.plant.findMany({
    where: { organizationId: auth.user.organizationId },
    select: {
      id: true,
      name: true,
      capacityKw: true,
      latitude: true,
      longitude: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    plants: plants.map((plant) => ({
      id: plant.id,
      name: plant.name,
      capacityKw: plant.capacityKw ? plant.capacityKw.toNumber() : null,
      latitude: plant.latitude ? plant.latitude.toNumber() : null,
      longitude: plant.longitude ? plant.longitude.toNumber() : null,
    })),
  });
}
