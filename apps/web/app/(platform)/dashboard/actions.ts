"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { Permissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { synchronizeFusionSolarConnection } from "@/lib/fusionsolar/telemetry-sync-service";
import { prisma } from "@/lib/prisma";

export type RefreshTelemetryResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Database-First Telemetry Architecture milestone: the explicit,
 * human-initiated "synchronize now" request — the only place outside
 * `lib/fusionsolar/telemetry-sync-service.ts` allowed to pass
 * `force: true` (besides deliberately-invoked engineering diagnostics).
 * Normal Dashboard/Market rendering never calls the sync service at all;
 * this action is the one exception, shared by both pages' Refresh
 * buttons.
 *
 * The sync itself is started via `after()` and never awaited here — this
 * action resolves as soon as the connection is confirmed to exist, so the
 * button's own response time is bounded by two small Postgres reads, not
 * by however long Huawei takes to respond. `revalidatePath` runs only
 * once the background sync actually completes with new data, from inside
 * the `after()` callback.
 */
export async function refreshFusionSolarTelemetry(): Promise<RefreshTelemetryResult> {
  const user = await requirePermission(Permissions.canViewPlants);

  const connection = await prisma.fusionSolarConnection.findUnique({
    where: {
      organizationId_provider: {
        organizationId: user.organizationId,
        provider: "HuaweiFusionSolar",
      },
    },
    select: { id: true },
  });

  if (!connection) {
    return {
      ok: false,
      error: "No FusionSolar connection found for this organization",
    };
  }

  after(() => {
    synchronizeFusionSolarConnection(connection.id, { force: true })
      .then((result) => {
        // Both pages read the same connection's telemetry; revalidate
        // both so whichever page the user is on (and the other, if
        // visited next) picks up the freshly-synced data.
        if (result.status === "synced") {
          revalidatePath("/dashboard");
          revalidatePath("/market");
        }
      })
      .catch((error: unknown) => {
        console.error(
          "[FusionSolar Telemetry Sync] Manual refresh background sync failed unexpectedly",
          { connectionId: connection.id, error },
        );
      });
  });

  return { ok: true };
}
