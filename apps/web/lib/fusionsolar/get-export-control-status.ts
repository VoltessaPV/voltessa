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
 * Two deliberately SEPARATE, non-interchangeable concepts. Each has its own
 * function and its own return type below, with no shared union type between
 * them and no fallback path from one to the other:
 *
 * - `getPlantConfiguredExportControlMode()` — the plant's *configured*
 *   export-control mode, from the documented Huawei configuration endpoint
 *   (`getActivePowerControlMode()`, reused as-is). This is the only source
 *   of truth for the configured limit. Per
 *   docs/research/fusionsolar-active-power-control.md, this endpoint
 *   exists and is fully specified, but currently returns `failCode 20609`
 *   for at least one production plant — callers MUST handle
 *   `available: false` explicitly and must never substitute another data
 *   source when it occurs.
 *
 * - `getPlantInverterOperatingState()` — each inverter's real-time
 *   *operating* state (Grid-connected / power limited / self-derating),
 *   from `inverter_state` via `getFusionSolarDeviceRealTimeKpi()`, reused
 *   as-is. This describes what the inverter is doing right now, not what
 *   it is configured to do. It is NOT a substitute for the configured mode
 *   above, even though the two states share similar-sounding vocabulary
 *   ("power limited") — a plant can be reported as `noLimit` in
 *   configuration while an individual inverter's operating state still
 *   momentarily reports `powerLimited` for unrelated grid-code reasons,
 *   and vice versa. Never merge these two results into one status; never
 *   render one in place of the other.
 *
 * See docs/research/fusionsolar-active-power-control.md for the full
 * evidence behind this distinction. Per that document's "Next
 * investigation" section, do not add a third data source here without new
 * evidence.
 */

export type ConfiguredExportControlMode =
  | {
      available: true;
      mode: ActivePowerControlModeResult;
    }
  | {
      available: false;
      reason: "configuration_endpoint_failed";
    };

/**
 * Reads the plant's configured export-control mode. Never falls back to
 * any other data source on failure — callers must display an explicit
 * "unavailable" state instead (see the dashboard's
 * "Configured export control unavailable" label).
 */
export async function getPlantConfiguredExportControlMode(
  connection: FusionSolarConnection,
  plantCode: string,
): Promise<ConfiguredExportControlMode> {
  try {
    const mode = await getActivePowerControlMode(connection, plantCode);

    return { available: true, mode };
  } catch (error) {
    if (!(error instanceof FusionSolarApiError)) {
      throw error;
    }

    // Expected, documented failure mode for this endpoint (e.g. failCode
    // 20609 — see docs/research/fusionsolar-active-power-control.md).
    // Deliberately does NOT fall back to any other data source.
    return { available: false, reason: "configuration_endpoint_failed" };
  }
}

export type InverterOperatingState =
  | "gridConnected"
  | "powerLimited"
  | "selfDerating"
  | "other";

export type InverterOperatingStateEntry = {
  deviceId: string;
  devName: string;
  state: InverterOperatingState;
  rawValue: number | null;
};

export type InverterOperatingStateResult =
  | {
      available: true;
      inverters: InverterOperatingStateEntry[];
    }
  | {
      available: false;
      reason:
        | "no_inverter_devices"
        | "request_failed"
        | "empty_response";
    };

function decodeInverterState(
  value: number | null | undefined,
): InverterOperatingState {
  if (value === 512) return "gridConnected";
  if (value === 513) return "powerLimited";
  if (value === 514) return "selfDerating";
  return "other";
}

/**
 * Reads each inverter's real-time operating state. This is NOT the
 * configured export-control mode — see the module doc comment above.
 *
 * @param inverterDevices Only string/residential inverter devices
 * (devTypeId 1 / 38) — the only device types `inverter_state` is
 * documented for.
 */
export async function getPlantInverterOperatingState(
  connection: FusionSolarConnection,
  inverterDevices: Array<{
    id: string;
    devName: string;
    huaweiDeviceId: bigint | null;
  }>,
): Promise<InverterOperatingStateResult> {
  const devicesWithId = inverterDevices.filter(
    (device): device is typeof device & { huaweiDeviceId: bigint } =>
      device.huaweiDeviceId !== null,
  );

  if (devicesWithId.length === 0) {
    return { available: false, reason: "no_inverter_devices" };
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
    return { available: false, reason: "request_failed" };
  }

  const deviceById = new Map(
    devicesWithId.map((device) => [
      device.huaweiDeviceId.toString(),
      device,
    ]),
  );

  const inverters: InverterOperatingStateEntry[] = [];

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
    return { available: false, reason: "empty_response" };
  }

  return { available: true, inverters };
}
