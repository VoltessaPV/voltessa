import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
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
 * Also the single place that schedules the background telemetry sync
 * (unforced — `synchronizeFusionSolarConnection`'s own internal freshness
 * check, `FUSIONSOLAR_SYNC_FRESHNESS_MS`, decides whether it actually
 * contacts Huawei or no-ops as `skipped_fresh`). Scheduled via `after()`,
 * so the response to this request is never delayed by it. On top of
 * `events.signIn`'s login-triggered sync, this restores automatic refresh
 * for a long-lived session that never signs in again: any Dashboard/Market
 * visit past the freshness window starts a background sync, and
 * `revalidatePath` runs only if that sync actually completed with new
 * data, so a subsequent render (or the same tab, on next navigation) picks
 * it up.
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

  if (connectionId) {
    after(() => {
      synchronizeFusionSolarConnection(connectionId)
        .then((result) => {
          if (result.status === "synced") {
            revalidatePath("/dashboard");
            revalidatePath("/market");
          }
        })
        .catch((error: unknown) => {
          console.error(
            "[FusionSolar Telemetry Sync] Background sync failed unexpectedly",
            { connectionId, error },
          );
        });
    });
  }

  return { plant, connectionId };
}
