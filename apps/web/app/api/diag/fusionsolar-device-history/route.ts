import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";
import {
  FusionSolarApiError,
  type FusionSolarConnection,
} from "@/lib/fusionsolar/api-client";
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
 * Two request contracts are supported side by side (`?mode=old` /
 * `?mode=new`) since it is not yet confirmed which one this plant's
 * Huawei tenant currently expects — see
 * `lib/fusionsolar/device-history-kpi.ts` for the exact shapes. Neither
 * mode is assumed correct in advance; both are exercised and reported.
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

type Mode = "old" | "new";

type DeviceRow = {
  id: string;
  devName: string;
  devDn: string;
  huaweiDeviceId: string | null;
};

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

function upstreamErrorShape(error: unknown) {
  if (error instanceof FusionSolarApiError) {
    return {
      upstream: {
        httpStatus: error.httpStatus,
        failCode: error.failCode,
        message: error.message,
        responseBody: error.response,
      },
    };
  }

  return {
    reason: error instanceof Error ? error.message : String(error),
  };
}

async function queryDeviceHistoryOld(
  connection: FusionSolarConnection,
  devTypeId: number,
  devIds: string,
  collectTime: number,
  devices: DeviceRow[],
) {
  const base = {
    mode: "old" as const,
    devTypeId,
    devIds,
    collectTime,
    collectTimeIso: new Date(collectTime).toISOString(),
    devices,
  };

  try {
    const raw = await getFusionSolarDeviceFiveMinuteHistory(connection, {
      mode: "old",
      devTypeId,
      devIds,
      collectTime,
    });

    return {
      ok: true as const,
      ...base,
      raw,
      validation: analyzeHistoryResponse(raw),
    };
  } catch (error) {
    return { ok: false as const, ...base, ...upstreamErrorShape(error) };
  }
}

async function queryDeviceHistoryNew(
  connection: FusionSolarConnection,
  devTypeId: number,
  startTime: number,
  endTime: number,
  device: DeviceRow,
) {
  const base = {
    mode: "new" as const,
    devTypeId,
    devDn: device.devDn,
    startTime,
    startTimeIso: new Date(startTime).toISOString(),
    endTime,
    endTimeIso: new Date(endTime).toISOString(),
    device,
  };

  try {
    const raw = await getFusionSolarDeviceFiveMinuteHistory(connection, {
      mode: "new",
      devTypeId,
      devDn: device.devDn,
      startTime,
      endTime,
    });

    return {
      ok: true as const,
      ...base,
      raw,
      validation: analyzeHistoryResponse(raw),
    };
  } catch (error) {
    return { ok: false as const, ...base, ...upstreamErrorShape(error) };
  }
}

export async function GET(request: NextRequest) {
  const modeParam = request.nextUrl.searchParams.get("mode");

  if (modeParam !== "old" && modeParam !== "new") {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_mode",
        message: "Query parameter `mode` must be exactly `old` or `new`.",
      },
      { status: 400 },
    );
  }
  const mode: Mode = modeParam;

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
      devDn: true,
      devTypeId: true,
      huaweiDeviceId: true,
    },
  });

  const inverterDevices: DeviceRow[] = devices
    .filter((d) => d.devTypeId === INVERTER_DEV_TYPE_ID)
    .map((d) => ({
      id: d.id,
      devName: d.devName,
      devDn: d.devDn,
      huaweiDeviceId: d.huaweiDeviceId?.toString() ?? null,
    }));

  const meterDevices: DeviceRow[] = devices
    .filter((d) => d.devTypeId === METER_DEV_TYPE_ID)
    .map((d) => ({
      id: d.id,
      devName: d.devName,
      devDn: d.devDn,
      huaweiDeviceId: d.huaweiDeviceId?.toString() ?? null,
    }));

  const now = Date.now();
  const results: Record<string, unknown> = {};

  if (mode === "old") {
    const inverterDevIds = inverterDevices
      .map((d) => d.huaweiDeviceId)
      .filter((id): id is string => Boolean(id))
      .join(",");
    const meterDevIds = meterDevices
      .map((d) => d.huaweiDeviceId)
      .filter((id): id is string => Boolean(id))
      .join(",");

    const todayCollectTime = now;
    const yesterdayCollectTime = now - ONE_DAY_MS;

    results.inverters_today = inverterDevIds
      ? await queryDeviceHistoryOld(
          connection,
          INVERTER_DEV_TYPE_ID,
          inverterDevIds,
          todayCollectTime,
          inverterDevices,
        )
      : { ok: false, error: "no_inverter_devices" };

    results.inverters_yesterday = inverterDevIds
      ? await queryDeviceHistoryOld(
          connection,
          INVERTER_DEV_TYPE_ID,
          inverterDevIds,
          yesterdayCollectTime,
          inverterDevices,
        )
      : { ok: false, error: "no_inverter_devices" };

    results.meter_today = meterDevIds
      ? await queryDeviceHistoryOld(
          connection,
          METER_DEV_TYPE_ID,
          meterDevIds,
          todayCollectTime,
          meterDevices,
        )
      : { ok: false, error: "no_meter_devices" };

    results.meter_yesterday = meterDevIds
      ? await queryDeviceHistoryOld(
          connection,
          METER_DEV_TYPE_ID,
          meterDevIds,
          yesterdayCollectTime,
          meterDevices,
        )
      : { ok: false, error: "no_meter_devices" };
  } else {
    // "new" contract: one device per call, capped at a 24h span — so each
    // group becomes an array of one result per device instead of one
    // grouped call.
    const todayWindow = { startTime: now - ONE_DAY_MS, endTime: now };
    const yesterdayWindow = {
      startTime: now - 2 * ONE_DAY_MS,
      endTime: now - ONE_DAY_MS,
    };

    results.inverters_today = inverterDevices.length
      ? await Promise.all(
          inverterDevices.map((device) =>
            queryDeviceHistoryNew(
              connection,
              INVERTER_DEV_TYPE_ID,
              todayWindow.startTime,
              todayWindow.endTime,
              device,
            ),
          ),
        )
      : { ok: false, error: "no_inverter_devices" };

    results.inverters_yesterday = inverterDevices.length
      ? await Promise.all(
          inverterDevices.map((device) =>
            queryDeviceHistoryNew(
              connection,
              INVERTER_DEV_TYPE_ID,
              yesterdayWindow.startTime,
              yesterdayWindow.endTime,
              device,
            ),
          ),
        )
      : { ok: false, error: "no_inverter_devices" };

    results.meter_today = meterDevices.length
      ? await Promise.all(
          meterDevices.map((device) =>
            queryDeviceHistoryNew(
              connection,
              METER_DEV_TYPE_ID,
              todayWindow.startTime,
              todayWindow.endTime,
              device,
            ),
          ),
        )
      : { ok: false, error: "no_meter_devices" };

    results.meter_yesterday = meterDevices.length
      ? await Promise.all(
          meterDevices.map((device) =>
            queryDeviceHistoryNew(
              connection,
              METER_DEV_TYPE_ID,
              yesterdayWindow.startTime,
              yesterdayWindow.endTime,
              device,
            ),
          ),
        )
      : { ok: false, error: "no_meter_devices" };
  }

  return NextResponse.json({
    ok: true,
    mode,
    organizationId: user.organizationId,
    requestedAt: new Date(now).toISOString(),
    results,
  });
}
