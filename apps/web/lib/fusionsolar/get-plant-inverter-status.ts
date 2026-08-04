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

/**
 * Stable, machine-readable status identifier — translated at the render
 * site (`InvertersCard`'s `dashboard.inverters.status` namespace), never a
 * raw English string baked into the domain layer. One key per
 * `classifyInverterState` branch below.
 */
export type InverterStatusKey =
  | "noData"
  | "gridConnected"
  | "powerLimited"
  | "selfDerating"
  | "shutdown"
  | "standbyNoIrradiation"
  | "standby"
  | "starting"
  | "other";

export type InverterStatus = {
  deviceId: string;
  name: string;
  online: boolean;
  powerKw: number | null;
  /** Inverter internal temperature, °C (Huawei `dataItemMap.temperature`) — `null` only when no reading exists. */
  temperatureC: number | null;
  statusColor: InverterStatusColor;
  statusKey: InverterStatusKey;
};

export type InverterStatusResult =
  | { available: true; inverters: InverterStatus[] }
  | {
      available: false;
      /**
       * `"historical_day"` is never returned by this function — it's set
       * directly by `dashboard-data.ts` when rendering a non-today date
       * (a live Huawei read has no meaning for a day that already
       * happened), added to this type so `InvertersCard` can show
       * friendlier, accurate wording instead of misreporting "no inverter
       * devices configured" for a historical view (Dashboard UI final
       * polish milestone).
       */
      reason: "no_inverter_devices" | "request_failed" | "historical_day";
    };

/**
 * An inverter's `active_power` is already in kW for this device type/model
 * — confirmed against real data (these are `SUN2000-50KTL-M3`, 50 kW-rated,
 * inverters reading `31`-`44` at genuine mid-morning production; reading
 * that as watts would mean under 0.05 kW, physically absurd while the
 * meter simultaneously shows tens of kW genuinely flowing to the grid).
 * Never divided by 1000 — that conversion is only correct for the meter
 * (`get-plant-power-status.ts`'s `meterWattsToKw`). See that module's doc
 * comment for the full investigation.
 */
function inverterKw(raw: number | null | undefined): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return null;
  }

  return Math.round(raw * 100) / 100;
}

/**
 * Classifies a documented `inverter_state` value (Table 5-1/5-2, see
 * docs/research/fusionsolar-active-power-control.md) into a Green/Yellow/
 * Red/Gray status. Only documented codes are given a specific label; any
 * other numeric value (documented-but-uncommon states like grid-scheduling
 * curves, terminal test, AFCI self-check, etc., or a genuinely unrecognized
 * code) falls into a neutral "Other" gray bucket rather than guessing.
 */
/**
 * Exported (Database-First Telemetry Architecture milestone) so
 * `dashboard-data.ts` can build the same classification from
 * `DeviceTelemetry.inverterState` instead of a live `getDevRealKpi` call —
 * same documented enumeration either way, no new meaning invented.
 */
export function classifyInverterState(rawValue: number | null): {
  color: InverterStatusColor;
  statusKey: InverterStatusKey;
  online: boolean;
} {
  if (rawValue === null) {
    return { color: "gray", statusKey: "noData", online: false };
  }

  if (rawValue === 512) {
    return { color: "green", statusKey: "gridConnected", online: true };
  }

  if (rawValue === 513) {
    return { color: "yellow", statusKey: "powerLimited", online: true };
  }

  if (rawValue === 514) {
    return { color: "yellow", statusKey: "selfDerating", online: true };
  }

  if (rawValue >= 768 && rawValue <= 774) {
    return { color: "red", statusKey: "shutdown", online: false };
  }

  if (rawValue === 40960) {
    return { color: "gray", statusKey: "standbyNoIrradiation", online: true };
  }

  if (rawValue >= 0 && rawValue <= 3) {
    return { color: "gray", statusKey: "standby", online: true };
  }

  if (rawValue === 256) {
    return { color: "gray", statusKey: "starting", online: true };
  }

  return { color: "gray", statusKey: "other", online: true };
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
      powerKw: kpi ? inverterKw(kpi.dataItemMap.active_power) : null,
      temperatureC: typeof kpi?.dataItemMap.temperature === "number" ? kpi.dataItemMap.temperature : null,
      statusColor: classification.color,
      statusKey: classification.statusKey,
    };
  });

  return { available: true, inverters };
}
