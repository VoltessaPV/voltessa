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
 * doc tables) is not modeled here, only `inverter_state`, which is the one
 * field this integration currently needs (confirmed authoritative per
 * docs/research/fusionsolar-active-power-control.md — an officially
 * documented enumeration, not a bitmask: 512 = Grid-connected, 513 = power
 * limited, 514 = self-derating). Only present for string/residential
 * inverter device types (devTypeId 1 / 38); absent for other device types
 * such as meters, hence optional.
 */
export type FusionSolarDeviceRealTimeKpiItem = {
  devId: number;
  sn?: string;
  dataItemMap: {
    inverter_state?: number | null;
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
