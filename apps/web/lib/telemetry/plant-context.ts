import type { Prisma } from "@prisma/client";
import { after } from "next/server";

import { synchronizeFusionSolarConnection } from "@/lib/fusionsolar/telemetry-sync-service";
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
 * Also the single place that schedules the background telemetry sync (via
 * the unchanged `lib/fusionsolar/telemetry-sync-service.ts`) — moved here
 * from being triggered redundantly inside every low-level query function.
 * Synchronization semantics (freshness threshold, atomic lease, non-
 * blocking `after()`) are completely unchanged (ADR-011/ADR-012) — only
 * how many times per request this decision gets made moves, from N times
 * to exactly once.
 */

export type PlantRenderContext = {
  plant: {
    id: string;
    name: string;
    plantCode: string | null;
    timezone: string;
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
      plantCode: true,
      timezone: true,
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

  if (connectionId) {
    after(() => {
      synchronizeFusionSolarConnection(connectionId).catch((error: unknown) => {
        console.error(
          "[FusionSolar Telemetry Sync] Background sync failed unexpectedly",
          { connectionId, error },
        );
      });
    });
  }

  return { plant, connectionId };
}
