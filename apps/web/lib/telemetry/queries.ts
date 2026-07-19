import type { DeviceTelemetry } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * The only place in the app that queries `DeviceTelemetry` directly (see
 * ADR-007, docs/research/telemetry-platform-foundation.md). Dashboard and
 * Market compose these functions instead of calling `prisma.deviceTelemetry`
 * themselves — this is a pure read layer, no HTTP, no business math (see
 * `lib/telemetry/energy-metrics.ts` for derived computations built on top).
 */

export const INVERTER_DEV_TYPE_ID = 1;
export const METER_DEV_TYPE_ID = 47;

/** All telemetry rows for a plant within `[start, end)`, ascending by timestamp. */
export async function getPlantTelemetryRange(params: {
  plantId: string;
  start: Date;
  end: Date;
  devTypeId?: number;
}): Promise<DeviceTelemetry[]> {
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
