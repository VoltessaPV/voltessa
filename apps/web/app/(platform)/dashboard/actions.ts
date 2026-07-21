"use server";

import { revalidatePath } from "next/cache";

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

  const result = await synchronizeFusionSolarConnection(connection.id, {
    force: true,
  });

  if (result.status === "failed") {
    return {
      ok: false,
      error: "Huawei synchronization failed — showing existing data",
    };
  }

  // Both pages read the same connection's telemetry; revalidate both so
  // whichever page the user is on (and the other, if visited next) picks
  // up the freshly-synced data.
  revalidatePath("/dashboard");
  revalidatePath("/market");

  return { ok: true };
}
