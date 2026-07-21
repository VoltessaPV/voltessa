import type { DeviceTelemetry } from "@prisma/client";
import { after } from "next/server";

import { synchronizeFusionSolarConnection } from "@/lib/fusionsolar/telemetry-sync-service";
import { prisma } from "@/lib/prisma";

/**
 * The only place in the app that queries `DeviceTelemetry` directly (see
 * ADR-007, docs/research/telemetry-platform-foundation.md). Dashboard and
 * Market compose these functions instead of calling `prisma.deviceTelemetry`
 * themselves — this is a pure read layer, no HTTP, no business math (see
 * `lib/telemetry/energy-metrics.ts` for derived computations built on top).
 *
 * Database-First Telemetry Architecture milestone: every exported function
 * here calls `ensurePlantTelemetryFresh` first. Synchronization is
 * therefore invisible to Dashboard/Market — they ask this repository for
 * telemetry, never for a sync; this is the one layer that knows both
 * "telemetry lives in the database" and "the database might need
 * refreshing first." The actual freshness/lease/Huawei decision lives
 * entirely in `lib/fusionsolar/telemetry-sync-service.ts` — this helper
 * only resolves which connection owns a plant and delegates.
 *
 * Non-Blocking Synchronization milestone (ADR-012): `ensurePlantTelemetryFresh`
 * never awaits `synchronizeFusionSolarConnection`. It schedules the sync via
 * Next.js `after()` — the sync runs once the response has already been sent,
 * so rendering always proceeds immediately from whatever is currently in
 * the database. Huawei is a synchronization source only; it can never add
 * latency to a Dashboard/Market request again, at the cost of `DeviceTelemetry`
 * possibly being one background-sync-cycle stale when a request happens to
 * land right as the freshness window expires. The only place allowed to
 * block on a real sync is the explicit Refresh action
 * (`app/(platform)/dashboard/actions.ts`), which calls
 * `synchronizeFusionSolarConnection` directly, and the scheduler's route,
 * which is not part of the render path at all.
 */

export const INVERTER_DEV_TYPE_ID = 1;
export const METER_DEV_TYPE_ID = 47;

/**
 * Resolves the plant's `FusionSolarConnection` and schedules a background
 * sync via `after()` — never awaits it, never contacts Huawei on the
 * request path itself. `synchronizeFusionSolarConnection` still owns every
 * decision (freshness, lease, force, error containment) and never throws;
 * the `.catch` below is pure defense against something unexpected inside
 * `after`'s callback, not a real error path. A plant with no connection
 * (not yet onboarded, or connection revoked) is a no-op: historical data
 * already in the database keeps rendering either way.
 */
export async function ensurePlantTelemetryFresh(plantId: string): Promise<void> {
  const plant = await prisma.plant.findUnique({
    where: { id: plantId },
    select: { organizationId: true },
  });

  if (!plant) {
    return;
  }

  const connection = await prisma.fusionSolarConnection.findUnique({
    where: {
      organizationId_provider: {
        organizationId: plant.organizationId,
        provider: "HuaweiFusionSolar",
      },
    },
    select: { id: true },
  });

  if (!connection) {
    return;
  }

  const connectionId = connection.id;

  after(() => {
    synchronizeFusionSolarConnection(connectionId).catch((error: unknown) => {
      console.error(
        "[FusionSolar Telemetry Sync] Background sync failed unexpectedly",
        { connectionId, error },
      );
    });
  });
}

/** All telemetry rows for a plant within `[start, end)`, ascending by timestamp. */
export async function getPlantTelemetryRange(params: {
  plantId: string;
  start: Date;
  end: Date;
  devTypeId?: number;
}): Promise<DeviceTelemetry[]> {
  await ensurePlantTelemetryFresh(params.plantId);

  return prisma.deviceTelemetry.findMany({
    where: {
      plantId: params.plantId,
      timestamp: { gte: params.start, lt: params.end },
      ...(params.devTypeId !== undefined
        ? { devTypeId: params.devTypeId }
        : {}),
    },
    orderBy: { timestamp: "asc" },
  });
}

/** The single most recent telemetry row for a plant (optionally scoped to one device type). */
export async function getLatestTelemetry(params: {
  plantId: string;
  devTypeId?: number;
}): Promise<DeviceTelemetry | null> {
  await ensurePlantTelemetryFresh(params.plantId);

  return prisma.deviceTelemetry.findFirst({
    where: {
      plantId: params.plantId,
      ...(params.devTypeId !== undefined
        ? { devTypeId: params.devTypeId }
        : {}),
    },
    orderBy: { timestamp: "desc" },
  });
}

export async function getLatestMeterTelemetry(
  plantId: string,
): Promise<DeviceTelemetry | null> {
  return getLatestTelemetry({ plantId, devTypeId: METER_DEV_TYPE_ID });
}

/**
 * One row per inverter device — each inverter's own most recent sample, not
 * a single plant-wide row. A plant can have several inverters, and their
 * timestamps aren't guaranteed to align exactly (confirmed in production:
 * inverters can start/stop reporting at slightly different times), so this
 * returns one independent "latest" per device rather than assuming they
 * share a timestamp.
 */
export async function getLatestInverterTelemetry(
  plantId: string,
): Promise<DeviceTelemetry[]> {
  await ensurePlantTelemetryFresh(plantId);

  const devices = await prisma.device.findMany({
    where: { plantId, devTypeId: INVERTER_DEV_TYPE_ID },
    select: { id: true },
  });

  const rows = await Promise.all(
    devices.map((device) =>
      prisma.deviceTelemetry.findFirst({
        where: { deviceId: device.id },
        orderBy: { timestamp: "desc" },
      }),
    ),
  );

  return rows.filter((row): row is DeviceTelemetry => row !== null);
}
