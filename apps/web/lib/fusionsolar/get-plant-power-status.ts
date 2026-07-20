import type { FusionSolarConnection } from "@/lib/fusionsolar/api-client";
import { getFusionSolarDeviceRealTimeKpi } from "@/lib/fusionsolar/device-real-time-kpi";

/**
 * Real-time plant power telemetry — current production and current grid
 * power (export/import), read directly from Huawei's real-time device KPI
 * endpoint (`getDevRealKpi`). This is a completely separate concern from
 * `get-export-control-status.ts`'s configured export-control mode: that
 * module answers "what is Huawei configured to do," this one answers
 * "what is the plant physically doing right now." Neither infers the
 * other's result.
 *
 * Production = sum of each inverter's real-time `active_power`
 * (devTypeId 1/38). Grid power = the meter's real-time `active_power`
 * (devTypeId 47), a single signed reading.
 *
 * Sign convention for the meter reading is confirmed, not assumed: real
 * production data showed all inverters at `active_power: 0` (nighttime,
 * `inverter_state: 40960` = standby/no irradiation) simultaneously with
 * the meter reporting a small NEGATIVE `active_power` — physically
 * consistent with only one explanation, drawing a small standby load from
 * the grid while producing nothing. Negative = importing from the grid;
 * positive = exporting to it.
 *
 * ## Unit conversion — NOT the same for both device types (Design-System
 * Consistency milestone, data-correctness fix)
 *
 * The meter's `active_power` is in **watts** — confirmed against real data
 * (a reading of `-1962` corresponds to a physically sane `-1.96` kW
 * standby-import load). This was previously assumed to also hold for
 * inverters and applied uniformly; it does not. Cross-checked directly
 * against production: these are `SUN2000-50KTL-M3` inverters (50 kW
 * rated), whose real-time `active_power` reads `31`-`44` at genuine
 * mid-morning production (confirmed via both the live `getDevRealKpi` call
 * and 8 independently-stored historical `DeviceTelemetry` rows spanning
 * multiple timestamps) — physically sane read directly as **kW** (31-44
 * kW from a 50 kW inverter), physically absurd read as watts (`0.03`-`0.04`
 * kW would mean the inverter is essentially off, while the meter
 * simultaneously shows tens of kW genuinely flowing to the grid — energy
 * that has to originate somewhere). The old uniform `/1000` conversion
 * therefore under-reported every "Produced" figure across the app by
 * roughly 1000x; see `docs/research/fusionsolar-active-power-control.md`
 * for the full investigation and `import-device-telemetry.ts`'s doc
 * comment for the corresponding historical-data backfill.
 */

const INVERTER_DEV_TYPE_ID = 1;
const METER_DEV_TYPE_ID = 47;

export type PlantPowerReading =
  | { available: true; kw: number }
  | { available: false; reason: string };

export type PlantPowerStatus = {
  currentProduction: PlantPowerReading;
  currentExport: PlantPowerReading;
  currentImport: PlantPowerReading;
};

/** The meter's `active_power` is in watts (confirmed against real data) — never assumed to already be kW. */
function meterWattsToKw(raw: number | null | undefined): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return null;
  }

  return Math.round((raw / 1000) * 100) / 100;
}

/** An inverter's `active_power` is already in kW for this device type/model (confirmed against real data — see this module's top doc comment) — never divided by 1000. */
function inverterKw(raw: number | null | undefined): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return null;
  }

  return Math.round(raw * 100) / 100;
}

function huaweiDeviceIds(
  devices: Array<{ huaweiDeviceId: bigint | null }>,
): string[] {
  return devices
    .map((device) => device.huaweiDeviceId)
    .filter((id): id is bigint => id !== null)
    .map((id) => id.toString());
}

async function getInverterProductionKw(
  connection: FusionSolarConnection,
  inverters: Array<{ huaweiDeviceId: bigint | null }>,
): Promise<PlantPowerReading> {
  const ids = huaweiDeviceIds(inverters);

  if (ids.length === 0) {
    return { available: false, reason: "no_inverter_devices" };
  }

  let kpi;

  try {
    kpi = await getFusionSolarDeviceRealTimeKpi(
      connection,
      INVERTER_DEV_TYPE_ID,
      ids.join(","),
    );
  } catch {
    return { available: false, reason: "request_failed" };
  }

  const readings = kpi
    .map((item) => inverterKw(item.dataItemMap.active_power))
    .filter((kw): kw is number => kw !== null);

  if (readings.length === 0) {
    return { available: false, reason: "no_power_data" };
  }

  const totalKw =
    Math.round(readings.reduce((sum, kw) => sum + kw, 0) * 100) / 100;

  return { available: true, kw: totalKw };
}

async function getMeterGridPowerKw(
  connection: FusionSolarConnection,
  meters: Array<{ huaweiDeviceId: bigint | null }>,
): Promise<PlantPowerReading> {
  const ids = huaweiDeviceIds(meters);

  if (ids.length === 0) {
    return { available: false, reason: "no_meter_devices" };
  }

  let kpi;

  try {
    kpi = await getFusionSolarDeviceRealTimeKpi(
      connection,
      METER_DEV_TYPE_ID,
      ids.join(","),
    );
  } catch {
    return { available: false, reason: "request_failed" };
  }

  const readings = kpi
    .map((item) => meterWattsToKw(item.dataItemMap.active_power))
    .filter((kw): kw is number => kw !== null);

  if (readings.length === 0) {
    return { available: false, reason: "no_power_data" };
  }

  const totalKw =
    Math.round(readings.reduce((sum, kw) => sum + kw, 0) * 100) / 100;

  return { available: true, kw: totalKw };
}

/**
 * Reads current plant production and grid power. Never falls back or
 * estimates — each field is independently unavailable if its underlying
 * Huawei call fails or returns no usable reading.
 */
export async function getPlantCurrentPowerStatus(
  connection: FusionSolarConnection,
  devices: {
    inverters: Array<{ huaweiDeviceId: bigint | null }>;
    meters: Array<{ huaweiDeviceId: bigint | null }>;
  },
): Promise<PlantPowerStatus> {
  const currentProduction = await getInverterProductionKw(
    connection,
    devices.inverters,
  );
  const meterReading = await getMeterGridPowerKw(connection, devices.meters);

  if (!meterReading.available) {
    return {
      currentProduction,
      currentExport: meterReading,
      currentImport: meterReading,
    };
  }

  return {
    currentProduction,
    currentExport:
      meterReading.kw > 0
        ? { available: true, kw: meterReading.kw }
        : { available: true, kw: 0 },
    currentImport:
      meterReading.kw < 0
        ? { available: true, kw: Math.abs(meterReading.kw) }
        : { available: true, kw: 0 },
  };
}
