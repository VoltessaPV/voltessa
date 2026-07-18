import {
  FusionSolarApiError,
  type FusionSolarConnection,
} from "@/lib/fusionsolar/api-client";
import {
  getActivePowerControlMode,
  type ActivePowerControlModeResult,
} from "@/lib/fusionsolar/get-active-power-control-mode";
import { getFusionSolarDeviceRealTimeKpi } from "@/lib/fusionsolar/device-real-time-kpi";

/**
 * Orchestrates the plant-level export-control status shown on the
 * dashboard. Reuses two existing, independently-verified helpers — issues
 * no Huawei request of its own:
 *
 * 1. `getActivePowerControlMode()` — the documented, authoritative source
 *    for the plant's *configured* export limit. Per
 *    docs/research/fusionsolar-active-power-control.md, this endpoint
 *    exists and is fully specified, but is confirmed to currently return
 *    `failCode 20609` for at least one production plant — so it must be
 *    treated as "try first, may fail," not assumed to always succeed.
 * 2. `getFusionSolarDeviceRealTimeKpi()` — falls back to the confirmed,
 *    officially documented `inverter_state` enumeration (Grid-connected /
 *    power limited / self-derating) when (1) is unavailable. This is NOT
 *    the configured limit — it's each inverter's own real-time operating
 *    state — and is surfaced to callers tagged with its own source, never
 *    relabeled as the configured limit.
 *
 * See docs/research/fusionsolar-active-power-control.md for the full
 * evidence behind this fallback design. Per that document's "Next
 * investigation" section, do not add a third data source here without new
 * evidence.
 */

export type InverterExportState =
  | "gridConnected"
  | "powerLimited"
  | "selfDerating"
  | "other";

export type InverterExportStatus = {
  deviceId: string;
  devName: string;
  state: InverterExportState;
  rawValue: number | null;
};

export type ExportControlStatus =
  | {
      source: "configuration";
      mode: ActivePowerControlModeResult;
    }
  | {
      source: "inverterState";
      inverters: InverterExportStatus[];
    }
  | {
      source: "unavailable";
      reason:
        | "configuration_failed_no_inverter_devices"
        | "inverter_state_unavailable"
        | "inverter_state_empty";
    };

function decodeInverterState(
  value: number | null | undefined,
): InverterExportState {
  if (value === 512) return "gridConnected";
  if (value === 513) return "powerLimited";
  if (value === 514) return "selfDerating";
  return "other";
}

/**
 * @param inverterDevices Only string/residential inverter devices
 * (devTypeId 1 / 38) — the only device types `inverter_state` is
 * documented for.
 */
export async function getPlantExportControlStatus(
  connection: FusionSolarConnection,
  plantCode: string,
  inverterDevices: Array<{
    id: string;
    devName: string;
    huaweiDeviceId: bigint | null;
  }>,
): Promise<ExportControlStatus> {
  try {
    const mode = await getActivePowerControlMode(connection, plantCode);

    return { source: "configuration", mode };
  } catch (error) {
    if (!(error instanceof FusionSolarApiError)) {
      throw error;
    }

    // Expected, documented failure mode for this endpoint (e.g. failCode
    // 20609 — see docs/research/fusionsolar-active-power-control.md) —
    // fall through to the inverter_state fallback below.
  }

  const devicesWithId = inverterDevices.filter(
    (device): device is typeof device & { huaweiDeviceId: bigint } =>
      device.huaweiDeviceId !== null,
  );

  if (devicesWithId.length === 0) {
    return {
      source: "unavailable",
      reason: "configuration_failed_no_inverter_devices",
    };
  }

  const devIds = devicesWithId
    .map((device) => device.huaweiDeviceId.toString())
    .join(",");

  let kpiResult;

  try {
    kpiResult = await getFusionSolarDeviceRealTimeKpi(
      connection,
      1,
      devIds,
    );
  } catch {
    return { source: "unavailable", reason: "inverter_state_unavailable" };
  }

  const deviceById = new Map(
    devicesWithId.map((device) => [
      device.huaweiDeviceId.toString(),
      device,
    ]),
  );

  const inverters: InverterExportStatus[] = [];

  for (const item of kpiResult) {
    const device = deviceById.get(item.devId.toString());

    if (!device) {
      continue;
    }

    const rawValue = item.dataItemMap.inverter_state ?? null;

    inverters.push({
      deviceId: device.id,
      devName: device.devName,
      state: decodeInverterState(rawValue),
      rawValue,
    });
  }

  if (inverters.length === 0) {
    return { source: "unavailable", reason: "inverter_state_empty" };
  }

  return { source: "inverterState", inverters };
}
