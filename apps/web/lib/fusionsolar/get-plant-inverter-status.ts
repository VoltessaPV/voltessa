import type { FusionSolarConnection } from "@/lib/fusionsolar/api-client";
import { getFusionSolarDeviceRealTimeKpi } from "@/lib/fusionsolar/device-real-time-kpi";

/**
 * Per-inverter real-time status for the Dashboard's Inverters card (Final
 * Dashboard UX Refinement milestone) — every inverter shown individually,
 * never aggregated into one number, per that milestone's explicit
 * requirement.
 *
 * Reuses `getFusionSolarDeviceRealTimeKpi` as-is (the same call
 * `get-plant-power-status.ts` and `get-export-control-status.ts` already
 * make) rather than adding a second Huawei endpoint — one call returns
 * both `active_power` and `inverter_state` per device, so this reads both
 * from that single response instead of calling twice.
 *
 * Deliberately a different (finer) status mapping than
 * `get-export-control-status.ts`'s `decodeInverterState` /
 * `InverterOperatingState` (`gridConnected`/`powerLimited`/`selfDerating`/
 * `other`): that mapping answers "is this a control-relevant operating
 * state" for the export-control comparison it exists for, collapsing every
 * non-512/513/514 code into one `other` bucket. The Inverters card needs a
 * genuine Green/Yellow/Red/Gray/online-offline distinction instead, so
 * fault states (`768`-`774`) and idle states (standby/starting) must be
 * told apart rather than both landing in the same bucket. Both mappings
 * decode the same officially-documented `inverter_state` enumeration (see
 * docs/research/fusionsolar-active-power-control.md) — no new meaning is
 * invented for any code, only a different, purpose-built bucketing of the
 * same documented values.
 */

const INVERTER_DEV_TYPE_ID = 1;

export type InverterStatusColor = "green" | "yellow" | "red" | "gray";

export type InverterStatus = {
  deviceId: string;
  name: string;
  online: boolean;
  powerKw: number | null;
  statusColor: InverterStatusColor;
  statusLabel: string;
};

export type InverterStatusResult =
  | { available: true; inverters: InverterStatus[] }
  | { available: false; reason: "no_inverter_devices" | "request_failed" };

/** Huawei reports `active_power` in watts (confirmed against real production data elsewhere in this integration). */
function wattsToKw(raw: number | null | undefined): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return null;
  }

  return Math.round((raw / 1000) * 100) / 100;
}

/**
 * Classifies a documented `inverter_state` value (Table 5-1/5-2, see
 * docs/research/fusionsolar-active-power-control.md) into a Green/Yellow/
 * Red/Gray status. Only documented codes are given a specific label; any
 * other numeric value (documented-but-uncommon states like grid-scheduling
 * curves, terminal test, AFCI self-check, etc., or a genuinely unrecognized
 * code) falls into a neutral "Other" gray bucket rather than guessing.
 */
function classifyInverterState(rawValue: number | null): {
  color: InverterStatusColor;
  label: string;
  online: boolean;
} {
  if (rawValue === null) {
    return { color: "gray", label: "No data", online: false };
  }

  if (rawValue === 512) {
    return { color: "green", label: "Grid-connected", online: true };
  }

  if (rawValue === 513) {
    return { color: "yellow", label: "Power limited", online: true };
  }

  if (rawValue === 514) {
    return { color: "yellow", label: "Self-derating", online: true };
  }

  if (rawValue >= 768 && rawValue <= 774) {
    return { color: "red", label: "Shutdown", online: false };
  }

  if (rawValue === 40960) {
    return { color: "gray", label: "Standby (no irradiation)", online: true };
  }

  if (rawValue >= 0 && rawValue <= 3) {
    return { color: "gray", label: "Standby", online: true };
  }

  if (rawValue === 256) {
    return { color: "gray", label: "Starting", online: true };
  }

  return { color: "gray", label: "Other", online: true };
}

/**
 * Reads every inverter's current power and operating status in one Huawei
 * call. A device with no matching item in the response (Huawei didn't
 * report it) is shown offline/gray rather than omitted — the card must
 * account for every configured inverter, not just the ones that answered.
 */
export async function getPlantInverterStatuses(
  connection: FusionSolarConnection,
  inverterDevices: Array<{
    id: string;
    devName: string;
    huaweiDeviceId: bigint | null;
  }>,
): Promise<InverterStatusResult> {
  const devicesWithId = inverterDevices.filter(
    (device): device is typeof device & { huaweiDeviceId: bigint } =>
      device.huaweiDeviceId !== null,
  );

  if (devicesWithId.length === 0) {
    return { available: false, reason: "no_inverter_devices" };
  }

  const devIds = devicesWithId.map((device) => device.huaweiDeviceId.toString());

  let kpiResult;

  try {
    kpiResult = await getFusionSolarDeviceRealTimeKpi(
      connection,
      INVERTER_DEV_TYPE_ID,
      devIds.join(","),
    );
  } catch {
    return { available: false, reason: "request_failed" };
  }

  const kpiByDeviceId = new Map(
    kpiResult.map((item) => [item.devId.toString(), item]),
  );

  const inverters: InverterStatus[] = devicesWithId.map((device) => {
    const huaweiId = device.huaweiDeviceId.toString();
    const kpi = kpiByDeviceId.get(huaweiId);
    const rawState = kpi?.dataItemMap.inverter_state ?? null;
    const classification = classifyInverterState(rawState);

    return {
      deviceId: device.id,
      name: device.devName,
      online: classification.online,
      powerKw: kpi ? wattsToKw(kpi.dataItemMap.active_power) : null,
      statusColor: classification.color,
      statusLabel: classification.label,
    };
  });

  return { available: true, inverters };
}
