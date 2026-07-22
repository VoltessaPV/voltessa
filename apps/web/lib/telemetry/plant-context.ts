import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * Repository-Layer Deduplication milestone. The single place that resolves
 * "which Huawei plant and FusionSolar connection does this organization's
 * Dashboard/Market page describe" — called exactly once per request by
 * `getDashboardPageData`/`getProductionPageData`, then reused for every
 * subsequent query instead of being re-derived per call (previously: up to
 * 3 separate `Plant` lookups and 3 separate `FusionSolarConnection` lookups
 * per Dashboard render, one pair per repository function that needed
 * freshness-checking — see the Prisma query trace this milestone is based
 * on).
 *
 * Login-triggered background sync milestone: this function no longer
 * schedules the telemetry sync itself — that now happens once, at
 * sign-in, via `lib/auth/config.ts`'s `events.signIn` handler, so the
 * user already has fresh data before ever reaching Dashboard/Market. This
 * function is plant/connection resolution only.
 */

export type PlantRenderContext = {
  plant: {
    id: string;
    name: string;
    capacityKw: Prisma.Decimal | null;
  };
  /** `null` when the organization has no FusionSolar connection at all (not yet onboarded, or revoked). */
  connectionId: string | null;
};

export async function resolvePlantContext(
  organizationId: string,
): Promise<PlantRenderContext | null> {
  const plant = await prisma.plant.findFirst({
    where: {
      organizationId,
      vendor: "Huawei",
      stationCode: { not: null },
      plantCode: { not: null },
    },
    select: {
      id: true,
      name: true,
      capacityKw: true,
    },
  });

  if (!plant) {
    return null;
  }

  const connection = await prisma.fusionSolarConnection.findUnique({
    where: {
      organizationId_provider: { organizationId, provider: "HuaweiFusionSolar" },
    },
    select: { id: true },
  });

  const connectionId = connection?.id ?? null;

  return { plant, connectionId };
}
