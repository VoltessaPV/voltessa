import {
  callFusionSolarApi,
  type FusionSolarConnection,
} from "@/lib/fusionsolar/api-client";

/**
 * Huawei thirdData "getDevFiveMinutes" — diagnostic use only. Two request
 * contracts have surfaced across Huawei's documentation history and neither
 * has been confirmed against this plant's real gateway yet:
 *
 * - "old" (SmartPVMS Interface Reference V300R006C00, 2018): `devIds`
 *   (comma-joined numeric device ids, up to 100, one device type) +
 *   `devTypeId` (string) + `collectTime` (string, a single anchor timestamp
 *   — Huawei returns whichever calendar day it falls in).
 * - "new" (SmartPVMS 25.4.0 documentation examples): `devDn` (a single
 *   device's DN string, e.g. "NE=37884931") + `devTypeId` (number) +
 *   `startTime`/`endTime` (explicit ms range, one device per call, capped
 *   at a 24-hour span).
 *
 * The endpoint path itself (`/thirdData/getDevFiveMinutes`) is unchanged
 * across every version checked — only the request body differs. This
 * helper sends whichever shape the caller asks for, completely unmodified;
 * it does not merge, rename, or normalize either contract, and does not
 * guess which one this plant's gateway/Huawei tenant actually expects.
 */
export type DeviceHistoryRequest =
  | {
      mode: "old";
      devTypeId: number;
      devIds: string;
      collectTime: number;
    }
  | {
      mode: "new";
      devTypeId: number;
      devDn: string;
      startTime: number;
      endTime: number;
    };

export async function getFusionSolarDeviceFiveMinuteHistory(
  connection: FusionSolarConnection,
  request: DeviceHistoryRequest,
): Promise<unknown> {
  const body =
    request.mode === "old"
      ? {
          devIds: request.devIds,
          devTypeId: String(request.devTypeId),
          collectTime: String(request.collectTime),
        }
      : {
          devDn: request.devDn,
          devTypeId: request.devTypeId,
          startTime: request.startTime,
          endTime: request.endTime,
        };

  const result = await callFusionSolarApi<unknown>(connection, {
    path: "/thirdData/getDevFiveMinutes",
    body,
  });

  return result.data;
}
