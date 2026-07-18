import {
  callFusionSolarApi,
  type FusionSolarConnection,
} from "@/lib/fusionsolar/api-client";

/**
 * Huawei thirdData "Real-Time Device Data Interface" — device-level KPIs,
 * scoped to a single devTypeId per call (Huawei does not allow mixing
 * device types in one request).
 *
 * Deliberately untyped (`unknown`): the response shape is not yet known —
 * this is a discovery step, not a modeled integration. Do not add a return
 * type here until the fields Voltessa actually needs have been decided.
 */
export async function getFusionSolarDeviceRealTimeKpi(
  connection: FusionSolarConnection,
  devTypeId: number,
  devIds: string,
): Promise<unknown> {
  const result = await callFusionSolarApi<unknown>(
    connection,
    {
      path: "/thirdData/getDevRealKpi",
      body: {
        devIds,
        devTypeId: String(devTypeId),
      },
    },
  );

  return result.data;
}
