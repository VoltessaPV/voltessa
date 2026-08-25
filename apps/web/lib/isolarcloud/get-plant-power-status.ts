import { callSungrowApi, type SungrowConnection } from "@/lib/isolarcloud/api-client";

/**
 * Real-time station power — Sungrow's equivalent of
 * `lib/fusionsolar/get-plant-power-status.ts`. Deliberately more
 * conservative than that module: Huawei's per-device-type real-time KPI
 * (separate inverter vs. meter `active_power` readings, confirmed against
 * real production data) lets this codebase confidently derive signed
 * export/import. The only confirmed-shape Sungrow endpoint found
 * (`getPowerStationRealTimeData`, third-party-derived — see
 * `api-client.ts`'s top doc comment) reports station-level "power" points
 * (point id `83033`) without a documented, confirmed split between
 * production and grid export/import the way Huawei's two separate device
 * types provide. Rather than guess a sign convention with no real Sungrow
 * data to check it against (the same kind of assumption that silently
 * under-reported Huawei production by ~1000x before it was empirically
 * corrected — see that module's doc comment), this only reports what the
 * single confirmed point plausibly means (instantaneous plant output) and
 * marks grid export/import explicitly unavailable until verified against a
 * real account/plant or the official documentation.
 */

const STATION_POWER_POINT_ID = "83033";

export type SungrowPlantPowerReading =
  | { available: true; kw: number }
  | { available: false; reason: string };

export type SungrowPlantPowerStatus = {
  currentProduction: SungrowPlantPowerReading;
  currentExport: SungrowPlantPowerReading;
  currentImport: SungrowPlantPowerReading;
};

type SungrowRealTimeDataItem = {
  ps_id: string;
  point_id: string;
  point_value?: number | string | null;
};

type SungrowRealTimeData = {
  ps_real_time_data_list?: SungrowRealTimeDataItem[];
};

function toKw(value: number | string | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100) / 100;
  }
  if (typeof value === "string" && value !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
  }
  return null;
}

export async function getSungrowPlantCurrentPowerStatus(
  connection: SungrowConnection,
  psId: string,
): Promise<SungrowPlantPowerStatus> {
  let data: SungrowRealTimeData;

  try {
    data = await callSungrowApi<SungrowRealTimeData>(
      connection,
      "/openapi/platform/getPowerStationRealTimeData",
      { ps_id_list: [psId], point_id_list: [STATION_POWER_POINT_ID] },
    );
  } catch {
    const unavailable: SungrowPlantPowerReading = {
      available: false,
      reason: "request_failed",
    };
    return { currentProduction: unavailable, currentExport: unavailable, currentImport: unavailable };
  }

  const powerItem = (data.ps_real_time_data_list ?? []).find(
    (item) => item.ps_id === psId && item.point_id === STATION_POWER_POINT_ID,
  );
  const kw = toKw(powerItem?.point_value);

  const currentProduction: SungrowPlantPowerReading =
    kw !== null ? { available: true, kw } : { available: false, reason: "no_power_data" };

  const unconfirmed: SungrowPlantPowerReading = {
    available: false,
    reason: "grid_export_import_split_unconfirmed",
  };

  return {
    currentProduction,
    currentExport: unconfirmed,
    currentImport: unconfirmed,
  };
}
