import { callSungrowApi, type SungrowConnection } from "@/lib/isolarcloud/api-client";

/**
 * Device discovery for a single station — Sungrow's equivalent of Huawei's
 * `getDevList` (see `lib/fusionsolar/sync-devices.ts`). Endpoint/field
 * names and the device-type codes below are third-party-derived
 * (`pysolarcloud`), not confirmed against Sungrow's own documentation — see
 * `api-client.ts`'s top doc comment.
 *
 * Deliberately NOT reusing Huawei's `INVERTER_DEV_TYPE_ID`/`METER_DEV_TYPE_ID`
 * constants (`lib/telemetry/queries.ts`, `lib/telemetry/plant-topology.ts`)
 * even where the numeric values happen to coincide — a coincidence across
 * two unrelated vendor code spaces is not something to build a dependency
 * on. Sungrow's own device-type codes are declared locally here instead.
 */

export const SUNGROW_DEVICE_TYPE = {
  INVERTER: 1,
  GRID_CONNECTION_POINT: 3,
  METER: 7,
  ENERGY_STORAGE_SYSTEM: 14,
} as const;

export type SungrowDevice = {
  uuid: string;
  deviceName: string;
  deviceType: number;
  deviceModel: string | null;
};

type SungrowDeviceListItem = {
  uuid: string;
  device_name?: string | null;
  device_type?: number | null;
  device_model?: string | null;
};

type SungrowDeviceListData = {
  pageList: SungrowDeviceListItem[];
  pageCount?: number;
};

const FIRST_PAGE = 1;
const PAGE_SIZE = 100;

function toDevice(item: SungrowDeviceListItem): SungrowDevice {
  return {
    uuid: item.uuid,
    deviceName: item.device_name ?? item.uuid,
    deviceType: item.device_type ?? 0,
    deviceModel: item.device_model ?? null,
  };
}

export async function getAllSungrowDevicesForStation(
  connection: SungrowConnection,
  psId: string,
): Promise<SungrowDevice[]> {
  const devices: SungrowDevice[] = [];

  let page = FIRST_PAGE;
  let pageCount = FIRST_PAGE;

  do {
    const data = await callSungrowApi<SungrowDeviceListData>(
      connection,
      "/openapi/platform/getDeviceListByPsId",
      { ps_id: psId, page, size: PAGE_SIZE },
    );

    devices.push(...(data.pageList ?? []).map(toDevice));

    pageCount = data.pageCount ?? FIRST_PAGE;
    page += 1;
  } while (page <= pageCount);

  return devices;
}
