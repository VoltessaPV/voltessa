import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * The only place in the app that queries `DeviceTelemetry` directly (see
 * ADR-007, docs/research/telemetry-platform-foundation.md). Dashboard and
 * Market compose these functions instead of calling `prisma.deviceTelemetry`
 * themselves — this is a pure read layer, no HTTP, no business math (see
 * `lib/telemetry/energy-metrics.ts` for derived computations built on top).
 *
 * Repository-Layer Deduplication milestone: every function here is now a
 * pure read — none of them trigger a freshness check/background sync
 * themselves anymore (that was `ensurePlantTelemetryFresh`, previously
 * called once per function, redundantly re-resolving the same plant's
 * connection on every call). Synchronization is now triggered exactly
 * once per request, by `lib/telemetry/plant-context.ts`'s
 * `resolvePlantContext` — callers resolve a `PlantRenderContext` once and
 * use its `plant.id` for every read below. Sync semantics themselves
 * (freshness threshold, atomic lease, non-blocking `after()`) are
 * unchanged (ADR-011/ADR-012).
 *
 * Every query below has an explicit `select` — only the columns each
 * function's actual callers read, never the full row (in particular,
 * never `rawPayload`, a ~100-key JSON blob per inverter sample that no
 * caller of these specific functions ever reads).
 */

export const INVERTER_DEV_TYPE_ID = 1;
export const METER_DEV_TYPE_ID = 47;

const TELEMETRY_SERIES_SELECT = {
  timestamp: true,
  devTypeId: true,
  activePower: true,
  meterActivePower: true,
  activeEnergy: true,
  reverseActiveEnergy: true,
} as const;

/** Row shape for `getPlantTelemetryRange` — the union of fields `energy-metrics.ts`'s two consumers (`getPlantTelemetrySeries`, `getPlantSettlementEnergySeries`) actually read. */
export type TelemetrySeriesRow = {
  timestamp: Date;
  devTypeId: number;
  activePower: Prisma.Decimal | null;
  meterActivePower: Prisma.Decimal | null;
  activeEnergy: Prisma.Decimal | null;
  reverseActiveEnergy: Prisma.Decimal | null;
};

/** All telemetry rows for a plant within `[start, end)`, ascending by timestamp. */
export async function getPlantTelemetryRange(params: {
  plantId: string;
  start: Date;
  end: Date;
  devTypeId?: number;
}): Promise<TelemetrySeriesRow[]> {
  return prisma.deviceTelemetry.findMany({
    where: {
      plantId: params.plantId,
      timestamp: { gte: params.start, lt: params.end },
      ...(params.devTypeId !== undefined
        ? { devTypeId: params.devTypeId }
        : {}),
    },
    select: TELEMETRY_SERIES_SELECT,
    orderBy: { timestamp: "asc" },
  });
}

/** Timestamp of the single most recent telemetry row for a plant (any device type) — this is all `production-data.ts`'s "Last update" field ever reads. */
export async function getLatestTelemetryTimestamp(
  plantId: string,
): Promise<Date | null> {
  const row = await prisma.deviceTelemetry.findFirst({
    where: { plantId },
    select: { timestamp: true },
    orderBy: { timestamp: "desc" },
  });

  return row?.timestamp ?? null;
}

/** Row shape for `getLatestMeterTelemetry` — only field its one caller (`deriveGridReadings`) reads. */
export type LatestMeterRow = {
  meterActivePower: Prisma.Decimal | null;
};

export async function getLatestMeterTelemetry(
  plantId: string,
): Promise<LatestMeterRow | null> {
  return prisma.deviceTelemetry.findFirst({
    where: { plantId, devTypeId: METER_DEV_TYPE_ID },
    select: { meterActivePower: true },
    orderBy: { timestamp: "desc" },
  });
}

/** Row shape for `getLatestInverterTelemetryForDevices` — only fields its callers (`sumInverterProduction`, Dashboard's inverter-status builder) read. */
export type LatestInverterRow = {
  deviceId: string;
  activePower: Prisma.Decimal | null;
  inverterState: number | null;
};

/**
 * One row per inverter device — each inverter's own most recent sample, not
 * a single plant-wide row. A plant can have several inverters, and their
 * timestamps aren't guaranteed to align exactly (confirmed in production:
 * inverters can start/stop reporting at slightly different times), so this
 * returns one independent "latest" per device rather than assuming they
 * share a timestamp.
 *
 * Takes device IDs directly rather than a `plantId` (previously: queried
 * `Device` internally, once per call — now the caller resolves the device
 * list once and passes it in, since both Dashboard and Market need the
 * same inverter telemetry and previously each re-fetched it independently).
 */
export async function getLatestInverterTelemetryForDevices(
  deviceIds: string[],
): Promise<LatestInverterRow[]> {
  const rows = await Promise.all(
    deviceIds.map((deviceId) =>
      prisma.deviceTelemetry.findFirst({
        where: { deviceId },
        select: { deviceId: true, activePower: true, inverterState: true },
        orderBy: { timestamp: "desc" },
      }),
    ),
  );

  return rows.filter((row): row is LatestInverterRow => row !== null);
}
