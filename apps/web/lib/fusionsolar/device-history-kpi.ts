import {
  callFusionSolarApi,
  type FusionSolarConnection,
} from "@/lib/fusionsolar/api-client";

/**
 * Huawei thirdData "Interface of Equipment for 5 Min Data" — diagnostic
 * use only, per docs/research/fusionsolar-active-power-control.md's
 * evidence-gathering pattern. Deliberately returns `unknown`, not a typed
 * model: this milestone's explicit goal is to observe Huawei's real,
 * unmodified response for this plant, not to assume a shape in advance.
 *
 * Per the official SmartPVMS Interface Reference (V300R006C00): supports
 * one device type, 100 devices, and one day of 5-minute data per query.
 * The documented sample request quotes both `devTypeId` and `collectTime`
 * as strings (unlike the station-level interfaces, which use a bare
 * numeric collectTime) — mirrored exactly here.
 */
export async function getFusionSolarDeviceFiveMinuteHistory(
  connection: FusionSolarConnection,
  devTypeId: number,
  devIds: string,
  collectTime: number,
): Promise<unknown> {
  const result = await callFusionSolarApi<unknown>(connection, {
    path: "/thirdData/getDevFiveMinutes",
    body: {
      devIds,
      devTypeId: String(devTypeId),
      collectTime: String(collectTime),
    },
  });

  return result.data;
}
