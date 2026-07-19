import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { FusionSolarApiError } from "@/lib/fusionsolar/api-client";
import { getFusionSolarDeviceFiveMinuteHistory } from "@/lib/fusionsolar/device-history-kpi";
import { prisma } from "@/lib/prisma";

/**
 * TEMPORARY diagnostic route for the "prove Huawei's historical KPI
 * capability" milestone. Tests `getDevFiveMinutes` for inverters
 * (devTypeId 1) and the meter (devTypeId 47), for today and yesterday,
 * against this organization's real connected plant. Returns Huawei's
 * response completely unmodified (`raw`) alongside a separate,
 * non-destructive `validation` analysis — never merges the two, never
 * renames or filters a single field of the raw payload.
 *
 * Read-only: only ever calls the documented historical query endpoint.
 * Never writes anything to Huawei.
 */

export const runtime = "nodejs";
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

const INVERTER_DEV_TYPE_ID = 1;
const METER_DEV_TYPE_ID = 47;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type RawHistoryItem = {
  devId?: unknown;
  sn?: unknown;
  collectTime?: unknown;
  dataItemMap?: Record<string, unknown>;
};

function isRawHistoryItem(value: unknown): value is RawHistoryItem {
  return typeof value === "object" && value !== null;
}

function analyzeHistoryResponse(raw: unknown) {
  if (!Array.isArray(raw)) {
    return {
      isArray: false,
      note: "Response `data` was not an array — see `raw` for the exact value Huawei returned.",
    };
  }

  const items = raw.filter(isRawHistoryItem);
  const byDevice = new Map<string, RawHistoryItem[]>();

  for (const item of items) {
    const devId =
      item.devId !== undefined ? String(item.devId) : "(missing devId)";
    const group = byDevice.get(devId) ?? [];

    group.push(item);
    byDevice.set(devId, group);
  }

  const perDevice = [...byDevice.entries()].map(([devId, group]) => {
    const timestamps = group
      .map((item) =>
        typeof item.collectTime === "number"
          ? item.collectTime
          : Number(item.collectTime),
      )
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b);

    const uniqueTimestamps = [...new Set(timestamps)];
    const duplicateTimestampCount = timestamps.length - uniqueTimestamps.length;

    const diffs: number[] = [];
    for (let i = 1; i < uniqueTimestamps.length; i += 1) {
      const previous = uniqueTimestamps[i - 1];
      const current = uniqueTimestamps[i];
      if (previous !== undefined && current !== undefined) {
        diffs.push(current - previous);
      }
    }

    const diffCounts = new Map<number, number>();
    for (const diff of diffs) {
      diffCounts.set(diff, (diffCounts.get(diff) ?? 0) + 1);
    }
    const sortedDiffCounts = [...diffCounts.entries()].sort(
      (a, b) => b[1] - a[1],
    );
    const modeDiffMs = sortedDiffCounts[0]?.[0] ?? null;
    const allDiffsConsistent = diffCounts.size <= 1;

    let missingTimestamps: string[] = [];
    if (modeDiffMs && uniqueTimestamps.length > 1) {
      const first = uniqueTimestamps[0];
      const last = uniqueTimestamps[uniqueTimestamps.length - 1];
      if (first !== undefined && last !== undefined) {
        const presentSet = new Set(uniqueTimestamps);
        const expected: number[] = [];
        for (let t = first; t <= last; t += modeDiffMs) {
          expected.push(t);
        }
        missingTimestamps = expected
          .filter((t) => !presentSet.has(t))
          .map((t) => new Date(t).toISOString());
      }
    }

    const kpiKeys = new Set<string>();
    for (const item of group) {
      if (item.dataItemMap && typeof item.dataItemMap === "object") {
        for (const key of Object.keys(item.dataItemMap)) {
          kpiKeys.add(key);
        }
      }
    }

    return {
      devId,
      sampleCount: group.length,
      uniqueTimestampCount: uniqueTimestamps.length,
      firstTimestamp: uniqueTimestamps[0]
        ? new Date(uniqueTimestamps[0]).toISOString()
        : null,
      lastTimestamp:
        uniqueTimestamps.length > 0
          ? new Date(
              uniqueTimestamps[uniqueTimestamps.length - 1] as number,
            ).toISOString()
          : null,
      samplingIntervalMinutes:
        modeDiffMs !== null ? modeDiffMs / 60000 : null,
      allIntervalsConsistent: allDiffsConsistent,
      duplicateTimestampCount,
      missingTimestampCount: missingTimestamps.length,
      missingTimestamps,
      availableKpis: [...kpiKeys].sort(),
      hasActivePower: kpiKeys.has("active_power"),
      hasInverterState: kpiKeys.has("inverter_state"),
    };
  });

  return {
    isArray: true,
    totalRawItemCount: items.length,
    deviceCount: byDevice.size,
    perDevice,
  };
}

async function queryDeviceHistory(
  connection: Parameters<typeof getFusionSolarDeviceFiveMinuteHistory>[0],
  devTypeId: number,
  devIds: string,
  collectTime: number,
  devices: Array<{ id: string; devName: string; huaweiDeviceId: string | null }>,
) {
  try {
    const raw = await getFusionSolarDeviceFiveMinuteHistory(
      connection,
      devTypeId,
      devIds,
      collectTime,
    );

    return {
      ok: true as const,
      devTypeId,
      devIds,
      collectTime,
      collectTimeIso: new Date(collectTime).toISOString(),
      devices,
      raw,
      validation: analyzeHistoryResponse(raw),
    };
  } catch (error) {
    if (error instanceof FusionSolarApiError) {
      return {
        ok: false as const,
        devTypeId,
        devIds,
        collectTime,
        collectTimeIso: new Date(collectTime).toISOString(),
        devices,
        upstream: {
          httpStatus: error.httpStatus,
          failCode: error.failCode,
          message: error.message,
          responseBody: error.response,
        },
      };
    }

    return {
      ok: false as const,
      devTypeId,
      devIds,
      collectTime,
      collectTimeIso: new Date(collectTime).toISOString(),
      devices,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function GET() {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { organizationId: true },
  });

  if (!user?.organizationId) {
    return NextResponse.json(
      { ok: false, error: "organization_not_found" },
      { status: 404 },
    );
  }

  const connection = await prisma.fusionSolarConnection.findUnique({
    where: {
      organizationId_provider: {
        organizationId: user.organizationId,
        provider: "HuaweiFusionSolar",
      },
    },
    select: {
      id: true,
      accessToken: true,
      refreshToken: true,
      tokenType: true,
      scope: true,
      expiresAt: true,
    },
  });

  if (!connection) {
    return NextResponse.json(
      { ok: false, error: "fusionsolar_connection_not_found" },
      { status: 404 },
    );
  }

  const devices = await prisma.device.findMany({
    where: {
      plant: { organizationId: user.organizationId },
      devTypeId: { in: [INVERTER_DEV_TYPE_ID, METER_DEV_TYPE_ID] },
    },
    select: {
      id: true,
      devName: true,
      devTypeId: true,
      huaweiDeviceId: true,
    },
  });

  const inverterDevices = devices
    .filter((d) => d.devTypeId === INVERTER_DEV_TYPE_ID && d.huaweiDeviceId !== null)
    .map((d) => ({
      id: d.id,
      devName: d.devName,
      huaweiDeviceId: d.huaweiDeviceId?.toString() ?? null,
    }));

  const meterDevices = devices
    .filter((d) => d.devTypeId === METER_DEV_TYPE_ID && d.huaweiDeviceId !== null)
    .map((d) => ({
      id: d.id,
      devName: d.devName,
      huaweiDeviceId: d.huaweiDeviceId?.toString() ?? null,
    }));

  const inverterDevIds = inverterDevices
    .map((d) => d.huaweiDeviceId)
    .filter((id): id is string => Boolean(id))
    .join(",");
  const meterDevIds = meterDevices
    .map((d) => d.huaweiDeviceId)
    .filter((id): id is string => Boolean(id))
    .join(",");

  const now = Date.now();
  const todayCollectTime = now;
  const yesterdayCollectTime = now - ONE_DAY_MS;

  const results: Record<string, unknown> = {};

  if (inverterDevIds) {
    results.inverters_today = await queryDeviceHistory(
      connection,
      INVERTER_DEV_TYPE_ID,
      inverterDevIds,
      todayCollectTime,
      inverterDevices,
    );
    results.inverters_yesterday = await queryDeviceHistory(
      connection,
      INVERTER_DEV_TYPE_ID,
      inverterDevIds,
      yesterdayCollectTime,
      inverterDevices,
    );
  } else {
    results.inverters_today = { ok: false, error: "no_inverter_devices" };
    results.inverters_yesterday = { ok: false, error: "no_inverter_devices" };
  }

  if (meterDevIds) {
    results.meter_today = await queryDeviceHistory(
      connection,
      METER_DEV_TYPE_ID,
      meterDevIds,
      todayCollectTime,
      meterDevices,
    );
    results.meter_yesterday = await queryDeviceHistory(
      connection,
      METER_DEV_TYPE_ID,
      meterDevIds,
      yesterdayCollectTime,
      meterDevices,
    );
  } else {
    results.meter_today = { ok: false, error: "no_meter_devices" };
    results.meter_yesterday = { ok: false, error: "no_meter_devices" };
  }

  return NextResponse.json({
    ok: true,
    organizationId: user.organizationId,
    requestedAt: new Date(now).toISOString(),
    results,
  });
}
