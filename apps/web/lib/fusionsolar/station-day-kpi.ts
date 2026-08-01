import {
  callFusionSolarApi,
  type FusionSolarConnection,
} from "@/lib/fusionsolar/api-client";

/**
 * Huawei thirdData "getKpiStationDay" — historical daily station KPI query,
 * never called by this codebase before this milestone (Historical Data
 * Auto-Import). `getStationRealKpi` (already integrated, `plant-data.ts`)
 * only ever returns *today's* live cumulative counters and has no date
 * parameter; this is the historical counterpart Huawei's "Report" API
 * family exposes for arbitrary past days.
 *
 * Request/response envelope matches every other `thirdData` endpoint this
 * codebase already calls (`{stationCodes, collectTime}` in,
 * `{success, failCode, message, data}` out, `api-client.ts`'s
 * `callFusionSolarApi` already unwraps that). `collectTime` anchors one
 * calendar day (in the station's own timezone) per call, the same
 * anchor-per-day shape `import-device-telemetry.ts` already uses for
 * `getDevFiveMinutes`.
 *
 * The exact `dataItemMap` field names are deliberately NOT typed here yet —
 * Huawei's own documentation portal returns empty content to automated
 * fetches in this environment (a known, previously-documented limitation),
 * and no independently-verifiable source lists them. Returns `unknown`,
 * exactly like `getFusionSolarDeviceFiveMinuteHistory` did before its own
 * contract was confirmed against a real response — do not guess a type here
 * before that happens. Once a real production response has been inspected
 * (see the temporary diagnostic route this milestone adds), replace this
 * `unknown` with a real `FusionSolarStationDayKpiItemMap` type derived from
 * that response, documented inline with which fields map to which
 * `PlantDailyKpi` columns.
 */
export async function getFusionSolarStationDayKpi(
  connection: FusionSolarConnection,
  params: { stationCode: string; collectTime: number },
): Promise<unknown> {
  const result = await callFusionSolarApi<unknown>(connection, {
    path: "/thirdData/getKpiStationDay",
    body: {
      stationCodes: params.stationCode,
      collectTime: params.collectTime,
    },
  });

  return result.data;
}
