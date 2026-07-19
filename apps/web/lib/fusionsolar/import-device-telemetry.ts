import { Prisma, TelemetryResolution } from "@prisma/client";

import type { FusionSolarConnection } from "@/lib/fusionsolar/api-client";
import { getFusionSolarDeviceFiveMinuteHistory } from "@/lib/fusionsolar/device-history-kpi";
import { prisma } from "@/lib/prisma";

/**
 * Pure telemetry import service — no HTTP awareness, no knowledge of any
 * route. Imports Huawei's historical 5-minute device data
 * (`getDevFiveMinutes`, the confirmed `devIds`/`devTypeId`/`collectTime`
 * contract only — see the diagnostic milestone that proved it against this
 * plant) for one plant over a time window, and writes it into
 * `DeviceTelemetry`.
 *
 * Idempotent by construction: relies on `DeviceTelemetry`'s
 * `(deviceId, timestamp, resolution)` unique constraint plus
 * `skipDuplicates`, so re-running over an overlapping (or identical) window
 * never creates duplicate rows.
 *
 * Huawei only supports querying one calendar day per `collectTime` anchor
 * (whichever day that timestamp falls in — see
 * `docs/research/fusionsolar-active-power-control.md`'s historical-KPI
 * findings), so an arbitrary window is covered by walking backward from
 * `windowEnd` in 24h steps until `windowStart` is reached.
 */

const INVERTER_DEV_TYPE_ID = 1;
const METER_DEV_TYPE_ID = 47;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type RawHistoryItem = {
  devId?: unknown;
  collectTime?: unknown;
  dataItemMap?: Record<string, unknown>;
};

function isRawHistoryItem(value: unknown): value is RawHistoryItem {
  return typeof value === "object" && value !== null;
}

function toDecimal(value: unknown): Prisma.Decimal | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return new Prisma.Decimal(value);
}

function toInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.trunc(value);
}

/**
 * Huawei reports `active_power` in watts, never kW (confirmed against real
 * production data — see `get-plant-power-status.ts`'s `wattsToKw`, the
 * origin of this same conversion for the real-time endpoint; the historical
 * endpoint was cross-checked against this diagnostic milestone's captured
 * meter data and shows the same scale/sign). The untouched raw watts value
 * is preserved in `rawPayload` regardless.
 */
function wattsToKw(value: unknown): Prisma.Decimal | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return new Prisma.Decimal(Math.round((value / 1000) * 100) / 100);
}

function computeCollectTimeAnchors(
  windowStart: Date,
  windowEnd: Date,
): number[] {
  const anchors: number[] = [];
  const startMs = windowStart.getTime();
  let cursor = windowEnd.getTime();

  while (cursor >= startMs) {
    anchors.push(cursor);
    cursor -= ONE_DAY_MS;
  }

  return anchors;
}

export type DeviceTelemetryImportResult = {
  plantId: string;
  devicesRequested: number;
  samplesFetched: number;
  samplesInserted: number;
  duplicatesSkipped: number;
  unmatchedSamples: number;
  errors: Array<{ devTypeId: number; collectTime: number; reason: string }>;
};

export async function importDeviceTelemetry(params: {
  connection: FusionSolarConnection;
  organizationId: string;
  plantId: string;
  windowStart: Date;
  windowEnd: Date;
}): Promise<DeviceTelemetryImportResult> {
  const { connection, organizationId, plantId, windowStart, windowEnd } =
    params;

  const rawDevices = await prisma.device.findMany({
    where: {
      plantId,
      plant: { organizationId },
      devTypeId: { in: [INVERTER_DEV_TYPE_ID, METER_DEV_TYPE_ID] },
    },
    select: { id: true, devTypeId: true, huaweiDeviceId: true },
  });

  const devices = rawDevices
    .filter(
      (d): d is typeof d & { huaweiDeviceId: bigint } =>
        d.huaweiDeviceId !== null,
    )
    .map((d) => ({
      id: d.id,
      devTypeId: d.devTypeId,
      huaweiDeviceId: d.huaweiDeviceId.toString(),
    }));

  const deviceByHuaweiId = new Map(
    devices.map((d) => [d.huaweiDeviceId, d] as const),
  );

  const devicesByType = new Map<number, typeof devices>();
  for (const device of devices) {
    const group = devicesByType.get(device.devTypeId) ?? [];
    group.push(device);
    devicesByType.set(device.devTypeId, group);
  }

  const anchors = computeCollectTimeAnchors(windowStart, windowEnd);

  const result: DeviceTelemetryImportResult = {
    plantId,
    devicesRequested: devices.length,
    samplesFetched: 0,
    samplesInserted: 0,
    duplicatesSkipped: 0,
    unmatchedSamples: 0,
    errors: [],
  };

  for (const [devTypeId, group] of devicesByType) {
    const devIds = group.map((d) => d.huaweiDeviceId).join(",");
    const isInverter = devTypeId === INVERTER_DEV_TYPE_ID;
    const isMeter = devTypeId === METER_DEV_TYPE_ID;

    for (const collectTime of anchors) {
      let raw: unknown;

      try {
        raw = await getFusionSolarDeviceFiveMinuteHistory(connection, {
          mode: "old",
          devTypeId,
          devIds,
          collectTime,
        });
      } catch (error) {
        result.errors.push({
          devTypeId,
          collectTime,
          reason: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      if (!Array.isArray(raw)) {
        result.errors.push({
          devTypeId,
          collectTime,
          reason: "response_not_array",
        });
        continue;
      }

      const items = raw.filter(isRawHistoryItem);
      result.samplesFetched += items.length;

      const rows: Prisma.DeviceTelemetryCreateManyInput[] = [];

      for (const item of items) {
        const huaweiDeviceId =
          item.devId !== undefined ? String(item.devId) : null;
        const device = huaweiDeviceId
          ? deviceByHuaweiId.get(huaweiDeviceId)
          : undefined;

        const timestampMs =
          typeof item.collectTime === "number"
            ? item.collectTime
            : Number(item.collectTime);

        if (!device || !huaweiDeviceId || !Number.isFinite(timestampMs)) {
          result.unmatchedSamples += 1;
          continue;
        }

        const dataItemMap = item.dataItemMap ?? {};

        rows.push({
          organizationId,
          plantId,
          deviceId: device.id,
          huaweiDeviceId: BigInt(huaweiDeviceId),
          devTypeId,
          timestamp: new Date(timestampMs),
          resolution: TelemetryResolution.FIVE_MIN,
          source: "HuaweiFusionSolar",
          activePower: isInverter
            ? wattsToKw(dataItemMap.active_power)
            : null,
          inverterState: isInverter
            ? toInt(dataItemMap.inverter_state)
            : null,
          temperature: isInverter ? toDecimal(dataItemMap.temperature) : null,
          meterActivePower: isMeter
            ? wattsToKw(dataItemMap.active_power)
            : null,
          meterStatus: isMeter ? toInt(dataItemMap.meter_status) : null,
          activeEnergy: isMeter ? toDecimal(dataItemMap.active_cap) : null,
          reverseActiveEnergy: isMeter
            ? toDecimal(dataItemMap.reverse_active_cap)
            : null,
          rawPayload: item as Prisma.InputJsonValue,
        });
      }

      if (rows.length === 0) {
        continue;
      }

      const inserted = await prisma.deviceTelemetry.createMany({
        data: rows,
        skipDuplicates: true,
      });

      result.samplesInserted += inserted.count;
      result.duplicatesSkipped += rows.length - inserted.count;
    }
  }

  return result;
}
