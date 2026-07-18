import {
  callFusionSolarApi,
  type FusionSolarConnection,
} from "@/lib/fusionsolar/api-client";

/**
 * Huawei thirdData "Real-Time Device Data Interface" — device-level KPIs,
 * scoped to a single devTypeId per call (Huawei does not allow mixing
 * device types in one request).
 *
 * `dataItemMap` is intentionally left mostly open (`[key: string]: unknown`)
 * — its full field set (~100 keys for string inverters, per the official
 * doc tables) is not modeled here. Two fields are typed because this
 * integration reads them directly:
 *
 * - `inverter_state` (confirmed authoritative per
 *   docs/research/fusionsolar-active-power-control.md — an officially
 *   documented enumeration, not a bitmask: 512 = Grid-connected, 513 =
 *   power limited, 514 = self-derating). Only present for string/
 *   residential inverter device types (devTypeId 1 / 38).
 * - `active_power` — real-time active power in **watts** (confirmed
 *   against real production data: a meter reading of `-1962` corresponds
 *   to ~1.96 kW; division by 1000 is required, not assumed). Present for
 *   both inverters (devTypeId 1/38, production) and meters (devTypeId 47,
 *   signed grid power — see `get-plant-power-status.ts` for the sign
 *   convention this integration relies on).
 */
export type FusionSolarDeviceRealTimeKpiItem = {
  devId: number;
  sn?: string;
  dataItemMap: {
    inverter_state?: number | null;
    active_power?: number | null;
    [key: string]: unknown;
  };
};

export async function getFusionSolarDeviceRealTimeKpi(
  connection: FusionSolarConnection,
  devTypeId: number,
  devIds: string,
): Promise<FusionSolarDeviceRealTimeKpiItem[]> {
  const result = await callFusionSolarApi<
    FusionSolarDeviceRealTimeKpiItem[]
  >(connection, {
    path: "/thirdData/getDevRealKpi",
    body: {
      devIds,
      devTypeId: String(devTypeId),
    },
  });

  return result.data;
}
