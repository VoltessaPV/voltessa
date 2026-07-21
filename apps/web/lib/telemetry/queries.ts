import type { DeviceTelemetry } from "@prisma/client";

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
 */

export const INVERTER_DEV_TYPE_ID = 1;
export const METER_DEV_TYPE_ID = 47;

/**
 * Resolves the plant's `FusionSolarConnection` and asks the sync service
 * whether it needs refreshing — never contacts Huawei itself, never
 * throws (the sync service already contains every failure). A plant with
 * no connection (not yet onboarded, or connection revoked) is a no-op:
 * historical data already in the database should keep rendering either
 * way.
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

  await synchronizeFusionSolarConnection(connection.id);
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
